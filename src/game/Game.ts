/**
 * Game: the state machine tying input, swing, ball physics, course, rendering, audio and UI.
 *
 *   title → (Play) → stance on the tee ⇄ walk (Tab) → swing → flight → settle → walk/stance …
 *   … → holed → scorecard → next hole … → final scorecard → title
 */
import * as THREE from 'three';
import { GAMEPLAY, MPH, PHYS, type SurfaceId } from '../config';
import type { Course } from '../course/Course';
import { HOLES } from '../course/layout';
import { settings } from '../core/settings';
import { Input } from '../core/Input';
import type { GameMode, HudView, ShotReport, UIHandlers } from '../core/view';
import { AudioSystem } from '../audio/Audio';
import { UI } from '../ui/UI';
import { World } from '../render/World';
import type { Modules } from '../render/registry';
import { globalUniforms } from '../render/shared';
import { CameraRig } from '../camera/CameraRig';
import { BallSim, type BallEvent } from '../physics/BallSim';
import { computeLaunch, launchToWorld, type LaunchData } from '../physics/impact';
import { BAG, SwingController, type SwingResult } from '../swing/SwingController';
import { Wind } from './Wind';
import { Round } from './Round';

const UP = new THREE.Vector3(0, 1, 0);
const tmpV = new THREE.Vector3();

interface PendingShot {
  launch: LaunchData;
  result: SwingResult;
  origin: THREE.Vector3;
  aimDir: THREE.Vector3;
  lie: SurfaceId;
  strokeNumber: number;
  onGreen: boolean;
}

export class Game {
  mode: GameMode = 'loading';
  private prevMode: GameMode = 'walk';
  input: Input;
  audio: AudioSystem;
  ui: UI;
  rig: CameraRig;
  wind = new Wind();
  round = new Round();
  swing = new SwingController();
  sim: BallSim;
  /** Ball at rest (or teed) position. */
  ball = new THREE.Vector3();
  /** Where the previous stroke was played from (stroke & distance). */
  prevBall = new THREE.Vector3();
  player = new THREE.Vector3();
  playerYaw = 0;
  crouch = 0;
  private walkVel = new THREE.Vector3();
  private shot: PendingShot | null = null;
  private settleTime = 0;
  private holedTime = 0;
  private lastReport: ShotReport | null = null;
  private hint = '';
  private rangefinder: HudView['rangefinder'] = null;
  private suggestPending = true;
  private rollSoundT = 0;
  private fastForward = false;
  private ballFlightPos = new THREE.Vector3();
  private time = 0;
  /** Shots this hole that can be retaken (ball positions before each stroke). */
  private history: { ball: THREE.Vector3; strokes: number }[] = [];

  constructor(
    public world: World,
    public mods: Modules,
    public course: Course,
    deps: { input: Input; audio: AudioSystem; ui: UI; handlers: { target: UIHandlers | null } },
  ) {
    this.input = deps.input;
    this.audio = deps.audio;
    this.ui = deps.ui;
    deps.handlers.target = {
      onPlay: ({ startHole, mode }) => this.startRound(startHole, mode),
      onResume: () => this.resume(),
      onQuitToTitle: () => this.toTitle(),
      onRestartHole: () => this.startHole(this.round.current, true),
      onNextHole: () => this.nextHole(),
      onCloseScorecard: () => {
        if (this.mode === 'scorecard') this.mode = this.prevMode;
      },
    };
    this.rig = new CameraRig(world.camera, course);
    this.rig.baseFov = settings.get('fov');
    settings.subscribe((s, ch) => {
      if (ch.includes('fov')) this.rig.baseFov = s.fov;
      if (ch.includes('masterVolume') || ch.includes('sfxVolume') || ch.includes('ambienceVolume')) this.audio.setVolumes(s.masterVolume, s.sfxVolume, s.ambienceVolume);
    });
    this.audio.setVolumes(settings.get('masterVolume'), settings.get('sfxVolume'), settings.get('ambienceVolume'));
    this.sim = new BallSim({
      terrain: course,
      world: mods.props,
      wind: (p, out) => this.wind.at(p, course.height(p.x, p.z), out),
    });
    this.swing.onAdjust = (k) => this.audio.adjust(k);
    // Small/costly objects stay out of the planar water reflection.
    mods.golfer.root.userData.noReflect = true;
    mods.props.ball.userData.noReflect = true;
    (mods.golfer as { setTrail?: (on: boolean) => void }).setTrail?.(true);
    mods.props.onPropHit = (e) => {
      this.audio.propHit(e.kind, e.speed);
      const ev = e as typeof e & { score?: number; broken?: boolean };
      if (e.kind === 'gong') this.ui.toast('GONG!', 'good');
      else if (e.kind === 'target') this.ui.toast(ev.score === 10 ? 'Bullseye! 10' : `Target hit — ${ev.score ?? 0}`, ev.score && ev.score >= 8 ? 'big' : 'good');
      else if (ev.broken) this.ui.toast('Smashed!', 'good');
      else if (e.kind === 'flagstick' && e.speed > 2) this.ui.toast('Off the flagstick!', 'info');
    };
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.exposeTestHooks();
  }

  // ───────────────────────────── flow ─────────────────────────────

  toTitle() {
    this.mode = 'title';
    this.input.setContext('menu');
    this.input.exitPointerLock();
    this.ui.hidePause();
    this.ui.hideScorecard();
    this.ui.hideShotReport();
    this.ui.showTitle(this.round.view());
    (this.mods.post as { setDof?: (e: boolean, f?: number) => void }).setDof?.(true, 60);
    const h = HOLES[0];
    this.world.hole = 0;
    this.mods.props.setActiveHole(0);
    this.mods.golfer.setVisible(false);
    const c = new THREE.Vector3(h.green.c[0], this.course.height(h.green.c[0], h.green.c[1]), h.green.c[1]);
    this.rig.snap(c.clone().add(new THREE.Vector3(60, 25, 60)), c);
  }

  startRound(startHole: number, mode: 'round' | 'practice') {
    this.round.reset(startHole, mode);
    this.ui.hideTitle();
    (this.mods.post as { setDof?: (e: boolean) => void }).setDof?.(false);
    this.startHole(startHole);
  }

  startHole(i: number, restart = false) {
    if (restart) {
      this.round.strokes = 0;
      this.round.holes[i] = { ...this.round.holes[i], strokes: null, putts: 0, fairway: null, gir: false, penalties: 0 };
    }
    this.round.current = i;
    this.round.strokes = 0;
    this.world.hole = i;
    this.ui.hidePause();
    this.ui.hideScorecard();
    this.ui.hideShotReport();
    const h = HOLES[i];
    this.mods.props.setActiveHole(i);
    this.mods.props.setFlagOut(false);
    (this.mods.effects as { clearAll?: () => void }).clearAll?.() ?? this.mods.effects.clearTracers();
    this.wind.reroll();
    this.history = [];
    // Tee the ball up at the front-centre of the tee box.
    const t = this.field().holes[i];
    const tee = new THREE.Vector3(h.tee[0] + t.teeDir[0] * 3, 0, h.tee[1] + t.teeDir[1] * 3);
    this.placeBall(tee);
    this.prevBall.copy(this.ball);
    this.swing.aim = 0;
    this.suggestPending = true;
    this.player.copy(this.ball);
    this.enterStance();
    this.rig.snap(this.ball.clone().addScaledVector(this.aimDir(), -4).add(new THREE.Vector3(0, 2, 0)), this.ball.clone().addScaledVector(this.aimDir(), 40));
    const dist = this.distToPin();
    this.ui.holeIntro(h.number, h.name, h.par, dist, h.blurb);
  }

  nextHole() {
    this.ui.hideScorecard();
    if (this.round.finished) {
      this.toTitle();
      return;
    }
    if (this.round.next()) this.startHole(this.round.current);
    else this.toTitle();
  }

  pause() {
    if (this.mode === 'paused' || this.mode === 'title' || this.mode === 'loading') return;
    this.prevMode = this.mode;
    this.mode = 'paused';
    this.input.setContext('menu');
    this.input.exitPointerLock();
    this.ui.showPause();
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.ui.hidePause();
    this.mode = this.prevMode;
    this.input.setContext(this.mode === 'walk' ? 'walk' : 'stance');
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private field() {
    return this.course.field;
  }

  placeBall(p: THREE.Vector3) {
    const s = this.course.surface(p.x, p.z);
    const teed = s === 'tee';
    this.ball.set(p.x, this.course.height(p.x, p.z) + PHYS.ballRadius + (teed ? 0.032 : 0), p.z);
    this.sim.place(this.ball);
    if (teed) this.sim.pos.y = this.ball.y;
  }

  get pin() {
    const h = HOLES[this.round.current];
    return new THREE.Vector3(h.pin[0], this.course.height(h.pin[0], h.pin[1]), h.pin[1]);
  }

  /** Unit horizontal direction from ball to pin, rotated by the player's aim offset. */
  aimDir(): THREE.Vector3 {
    const p = this.pin;
    const d = new THREE.Vector3(p.x - this.ball.x, 0, p.z - this.ball.z);
    if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
    d.normalize();
    return d.applyAxisAngle(UP, (-this.swing.aim * Math.PI) / 180);
  }

  distToPin() {
    const p = this.pin;
    return Math.hypot(p.x - this.ball.x, p.z - this.ball.z);
  }

  private lie(): SurfaceId {
    return this.course.surface(this.ball.x, this.ball.z);
  }

  private suggestClub(): number {
    const lie = this.lie();
    if (lie === 'green') return 4;
    const d = this.distToPin();
    const teed = lie === 'tee';
    if (lie === 'fringe' && d < 12) return 4;
    if (d < 95) return 3;
    if (d < 150) return 2;
    if (d < 185 || !teed) return d < 185 ? 1 : 1;
    return 0;
  }

  private enterStance() {
    this.mode = 'stance';
    this.input.setContext('stance');
    this.input.exitPointerLock();
    const lie = this.lie();
    const teed = lie === 'tee';
    this.swing.address(lie, teed, this.suggestPending ? this.suggestClub() : undefined);
    this.suggestPending = false;
    this.mods.golfer.setVisible(true);
    this.mods.props.setFlagOut(lie === 'green' && this.distToPin() < 25);
  }

  private enterWalk() {
    this.mode = 'walk';
    this.input.setContext('walk');
    this.mods.golfer.setVisible(false);
    // Face the ball (or pin).
    const target = this.distTo(this.ball) > 3 ? this.ball : this.pin;
    this.playerYaw = Math.atan2(-(target.x - this.player.x), -(target.z - this.player.z));
    this.rig.yaw = this.playerYaw;
    this.rig.pitch = -0.05;
  }

  private distTo(p: THREE.Vector3) {
    return Math.hypot(p.x - this.player.x, p.z - this.player.z);
  }

  /** Put the player beside the ball, ready to address it. */
  private goToBall() {
    const a = this.aimDir();
    this.player.copy(this.ball).addScaledVector(a, -1.2);
    this.suggestPending = true;
    this.enterStance();
  }

  // ───────────────────────────── per-frame ─────────────────────────────

  update(dtRaw: number) {
    const dt = Math.min(dtRaw, 0.05);
    this.time += dt;
    this.input.update();
    this.wind.update(dt);
    this.updateWindUniforms();
    this.audio.update(dt, this.wind.speed);

    if (this.input.pressed('pause') && !this.ui.menuOpen) {
      if (this.mode === 'paused') this.resume();
      else this.pause();
    }
    if (this.input.pressed('scorecard') && this.mode !== 'title' && this.mode !== 'paused') {
      if (this.mode === 'scorecard') {
        this.ui.hideScorecard();
        this.mode = this.prevMode;
      } else if (this.mode !== 'holed') {
        this.prevMode = this.mode;
        this.mode = 'scorecard';
        this.ui.showScorecard(this.round.view(), false);
      }
    }

    switch (this.mode) {
      case 'title':
        this.rig.orbit(this.pin, 70, 22, dt);
        break;
      case 'stance':
      case 'swing':
        this.updateStance(dt);
        break;
      case 'walk':
        this.updateWalk(dt);
        break;
      case 'flight':
        this.updateFlight(dt);
        break;
      case 'holed':
        this.updateHoled(dt);
        break;
      case 'freecam':
        this.updateFreecam(dt);
        break;
      default:
        break;
    }
    if (this.mode !== 'paused' && this.mode !== 'title') this.round.tick(dt, true);

    // Ball & uniforms
    const ballPos = this.mode === 'flight' ? this.sim.pos : this.ball;
    this.mods.props.setBall(ballPos, this.mode === 'flight' ? this.sim.spin : undefined, dt);
    globalUniforms.uBallPos.value.copy(ballPos);
    globalUniforms.uPlayerPos.value.copy(this.mode === 'walk' ? this.player : this.ball);
    this.world.mode = this.mode;
    // Shadows follow what the camera is looking at.
    const focus = tmpV.copy(this.rig.look).lerp(this.rig.pos, 0.6);
    this.world.updateSunShadow(focus);

    this.world.frame(dt);
    if (this.mode !== 'title' && this.mode !== 'loading') this.ui.update(this.hudView());
    this.input.endFrame();
  }

  private updateWindUniforms() {
    globalUniforms.uWindDir.value.set(this.wind.dir.x, this.wind.dir.z);
    globalUniforms.uWindSpeed.value = this.wind.speed;
    (this.mods.sky as { setWind?: (x: number, z: number, s: number) => void }).setWind?.(this.wind.dir.x, this.wind.dir.z, this.wind.speed);
  }

  private updateStance(dt: number) {
    const aim = this.aimDir();
    const putting = this.swing.club.kind === 'putter';
    // Toggle to walking
    if (this.input.pressed('toggleStance') && !this.swing.active) {
      this.player.copy(this.ball).addScaledVector(aim, -1.5).addScaledVector(new THREE.Vector3().crossVectors(aim, UP), -0.8);
      this.enterWalk();
      return;
    }
    if (settings.get('practiceSwingEnabled') && this.input.pressed('practiceSwing') && !this.swing.active) {
      this.swing.practice = !this.swing.practice;
      this.ui.toast(this.swing.practice ? 'Practice swing — the ball is safe' : 'Practice off — live ball', 'info');
    }
    if (this.input.pressed('retake') && !this.swing.active) this.retake();
    if (this.input.pressed('freeCam')) {
      this.mode = 'freecam';
      return;
    }
    // Pointer lock while dragging the hands.
    if (this.input.pressed('swingGrab')) this.input.requestPointerLock();
    if (this.input.released('swingGrab')) this.input.exitPointerLock();

    const res = this.swing.update(this.input, dt, true);
    const sv = this.swing.panelView();
    if (this.swing.active) this.audio.swingUpdate(sv.speedMph);
    else this.audio.swingUpdate(0);
    this.mods.golfer.setSwingPose({
      ballPos: this.ball,
      aimDir: aim,
      swing: sv,
      clubKind: this.swing.club.kind,
      clubLength: this.swing.club.length,
      face: this.swing.face + this.swing.faceDrift,
      stance: this.swing.stance,
    });
    this.rangefinderUpdate(dt);
    this.rig.address(this.ball, aim, dt, putting);
    this.hint = this.swing.practice
      ? 'PRACTICE — hold LMB and drag the hands. X: live ball'
      : this.swing.active
        ? 'A/D face · Q/E path — keep it square!'
        : 'Hold LMB + drag: swing · A/D face · Q/E path · Z/C aim · W/S stance · 1-5 club · Tab walk';
    if (res) this.onImpact(res, aim);
  }

  private onImpact(res: SwingResult, aim: THREE.Vector3) {
    const d = res.delivery;
    const speedMph = res.impact.clubSpeed / MPH;
    if (res.practice) {
      this.ui.toast(`Practice swing: ${speedMph.toFixed(0)} mph`, 'info');
      return;
    }
    if (res.impact.whiff || d.clubSpeed < 0.3) {
      // Air shot: counts as a stroke (Rules of Golf).
      this.round.addStroke(false);
      this.ui.toast('Whiff! (+1)', 'bad');
      this.audio.strike('whiff', d.club.kind, speedMph, d.lie);
      return;
    }
    const launch = computeLaunch(d);
    const { velocity, spin } = launchToWorld(launch, aim);
    const lie = d.lie;
    const onGreen = lie === 'green';
    this.history.push({ ball: this.ball.clone(), strokes: this.round.strokes });
    this.prevBall.copy(this.ball);
    this.round.addStroke(onGreen);
    this.shot = { launch, result: res, origin: this.ball.clone(), aimDir: aim.clone(), lie, strokeNumber: this.round.strokes, onGreen };
    this.sim.opts.cup = this.pin.clone();
    this.sim.pos.copy(this.ball);
    this.sim.launch(velocity, spin);
    this.mode = 'flight';
    this.input.exitPointerLock();
    this.rig.startFlight();
    this.ui.hideShotReport();
    this.fastForward = false;
    // Feedback
    const q = launch.quality;
    this.audio.strike(q, d.club.kind, speedMph, lie);
    const flush = q === 'pure' ? 1 : q === 'good' ? 0.6 : 0.2;
    if (settings.get('gamepadVibration')) this.input.vibrate(0.3 + 0.7 * (1 - flush) * 0.5 + flush * 0.4, 120);
    this.mods.effects.impactFlash(this.ball, flush);
    if (flush >= 1) this.rig.kick(0.03);
    const style = Math.abs(launch.spinAxis) < 3 ? 'straight' : launch.spinAxis < 0 ? 'draw' : 'fade';
    this.mods.effects.tracerStart(this.ball, style);
    if (lie === 'sand') this.mods.effects.sandSplash(this.ball, 0.7);
    else if (d.club.kind !== 'putter' && lie !== 'tee' && (d.attackAngle < -1 || d.fat > 0.05)) {
      this.mods.effects.divot(this.ball, aim, Math.min(1, 0.3 + d.fat + Math.max(0, -d.attackAngle) / 8));
    }
  }

  private updateFlight(dt: number) {
    if (this.input.held('returnToBall') || this.input.held('retake')) this.fastForward = true;
    const scale = this.fastForward ? 3.5 : 1;
    const events = this.sim.update(dt * scale);
    for (const e of events) this.onBallEvent(e);
    // Keep the golfer finishing the swing.
    this.swing.update(this.input, dt, false);
    if (this.shot) {
      this.mods.golfer.setSwingPose({
        ballPos: this.shot.origin,
        aimDir: this.shot.aimDir,
        swing: this.swing.panelView(),
        clubKind: this.swing.club.kind,
        clubLength: this.swing.club.length,
        face: this.swing.face,
        stance: this.swing.stance,
      });
    }
    this.ballFlightPos.copy(this.sim.pos);
    this.mods.effects.tracerPush(this.sim.pos);
    if (this.sim.state === 'rolling') {
      this.rollSoundT -= dt;
      if (this.rollSoundT <= 0) {
        this.audio.roll(this.sim.lastSurface, this.sim.vel.length());
        this.rollSoundT = 0.25;
      }
    }
    if (this.sim.moving) {
      this.rig.flight(this.sim.pos, this.sim.vel, this.shot?.origin ?? this.ball, dt);
      this.hint = 'Hold F to fast-forward';
      return;
    }
    // Ball has stopped.
    if (this.settleTime === 0) this.onBallStopped();
    this.settleTime += dt;
    this.rig.settle(this.sim.pos, dt);
    if (this.mode === 'flight' && this.settleTime > 1.6) {
      this.settleTime = 0;
      this.afterSettle();
    }
  }

  private onBallEvent(e: BallEvent) {
    switch (e.type) {
      case 'land':
      case 'bounce':
        if (e.speed > 1.5) this.audio.bounce(e.surface ?? 'fairway', e.speed);
        if (e.type === 'land') {
          if (e.surface === 'sand') this.mods.effects.sandSplash(e.pos, Math.min(1, e.speed / 30));
          else this.mods.effects.landPuff(e.pos, e.surface ?? 'fairway', Math.min(1, e.speed / 30));
        }
        break;
      case 'water':
        this.mods.effects.waterSplash(e.pos, Math.min(1, e.speed / 25 + 0.3));
        this.audio.splash(Math.min(1, e.speed / 25 + 0.3));
        break;
      case 'holed':
        this.audio.cup();
        break;
      case 'lipout':
        this.audio.bounce('green', 1);
        break;
      default:
        break;
    }
  }

  private onBallStopped() {
    this.mods.effects.tracerEnd();
    const shot = this.shot;
    const st = this.sim.state;
    let result: ShotReport['result'] = this.sim.lastSurface;
    if (st === 'holed') {
      result = 'holed';
      this.ball.copy(this.pin);
    } else if (st === 'water') {
      this.round.addPenalty(GAMEPLAY.penaltyWater);
      this.ui.toast('Water hazard — penalty stroke. Dropped near where it went in.', 'bad');
      this.audio.crowd('groan');
      this.placeBall(this.findDrop(this.sim.lastDry, shot?.origin ?? this.ball));
      result = 'water';
    } else if (st === 'oob') {
      this.round.addPenalty(GAMEPLAY.penaltyOOB);
      this.ui.toast('Out of bounds — stroke and distance.', 'bad');
      this.placeBall(this.prevBall);
      result = 'oob';
    } else {
      this.placeBall(this.sim.pos);
      result = this.lie();
    }
    if (shot) {
      this.round.noteResult(shot.strokeNumber, result);
      this.lastReport = this.makeReport(shot, result);
      if (settings.get('showShotData')) this.ui.showShotReport(this.lastReport);
    }
    if (st === 'holed') {
      this.round.holeOut();
      const diff = this.round.strokes - HOLES[this.round.current].par;
      const names: Record<string, string> = { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', '0': 'Par', '1': 'Bogey', '2': 'Double bogey' };
      const label = this.round.strokes === 1 ? 'HOLE IN ONE!' : names[String(diff)] ?? `${diff > 0 ? '+' : ''}${diff}`;
      this.ui.toast(`${label} — ${this.round.strokes} stroke${this.round.strokes > 1 ? 's' : ''}`, 'big');
      this.audio.crowd(diff <= -1 ? 'cheer' : 'applause');
      this.mode = 'holed';
      this.holedTime = 0;
      this.settleTime = 0;
      return;
    }
    // Stroke cap so a disaster hole never ends a session.
    if (this.round.strokes >= GAMEPLAY.maxStrokesPerHole) {
      this.ui.toast(`Stroke limit reached — picking up.`, 'bad');
      this.round.strokes = GAMEPLAY.maxStrokesPerHole;
      this.round.holeOut();
      this.mode = 'holed';
      this.holedTime = 0;
      this.settleTime = 0;
    }
  }

  private afterSettle() {
    this.shot = null;
    this.suggestPending = true;
    // Walk from where you hit (the original makes you walk). Quick option: F to go to the ball.
    const dist = Math.hypot(this.ball.x - this.prevBall.x, this.ball.z - this.prevBall.z);
    if (dist < 25 || this.lie() === 'green') {
      this.goToBall();
    } else {
      const aim = this.aimDir();
      this.player.copy(this.prevBall).addScaledVector(aim, -1);
      this.enterWalk();
    }
  }

  private updateHoled(dt: number) {
    this.holedTime += dt;
    this.rig.settle(this.pin, dt);
    if (this.holedTime > 2.8 && this.holedTime - dt <= 2.8) {
      this.ui.showScorecard(this.round.view(), this.round.finished);
    }
    if (this.holedTime > 2.8 && (this.input.pressed('toggleStance') || this.input.pressed('retake'))) this.nextHole();
  }

  private findDrop(lastDry: THREE.Vector3, origin: THREE.Vector3): THREE.Vector3 {
    const p = lastDry.clone();
    const back = new THREE.Vector3().subVectors(origin, lastDry).setY(0);
    const len = back.length();
    if (len > 0.01) back.normalize();
    for (let i = 0; i < 120; i++) {
      const s = this.course.surface(p.x, p.z);
      const near = this.course.waterHeight(p.x + 1.5, p.z) ?? this.course.waterHeight(p.x - 1.5, p.z) ?? this.course.waterHeight(p.x, p.z + 1.5) ?? this.course.waterHeight(p.x, p.z - 1.5);
      if (s !== 'water' && near === null && s !== 'oob') return p;
      p.addScaledVector(back, 0.5);
    }
    return origin.clone();
  }

  private retake() {
    const last = this.history.pop();
    if (!last) {
      this.ui.toast('Nothing to retake yet', 'info');
      return;
    }
    // Stroke-and-distance: return to the previous spot; the stroke stays and one penalty is added.
    this.round.addPenalty(1);
    this.placeBall(last.ball);
    this.prevBall.copy(last.ball);
    (this.mods.effects as { clearAll?: () => void }).clearAll?.() ?? this.mods.effects.clearTracers();
    this.ui.toast('Retake — stroke and distance (+1)', 'info');
    this.suggestPending = false;
    this.enterStance();
  }

  private updateWalk(dt: number) {
    const inp = this.input;
    const look = inp.consumeLookDelta();
    const ls = 0.0022 * settings.get('lookSensitivity') / this.rig.fovZoom;
    this.rig.yaw -= look.dx * ls;
    this.rig.pitch = Math.max(-1.3, Math.min(1.3, this.rig.pitch - look.dy * ls));
    if (inp.padLook) {
      this.rig.yaw -= inp.padLook.x * dt * 2.4;
      this.rig.pitch = Math.max(-1.3, Math.min(1.3, this.rig.pitch - inp.padLook.y * dt * 1.8));
    }
    this.playerYaw = this.rig.yaw;
    const fwd = (inp.held('moveForward') ? 1 : 0) - (inp.held('moveBack') ? 1 : 0) - inp.padMove.y;
    const str = (inp.held('moveRight') ? 1 : 0) - (inp.held('moveLeft') ? 1 : 0) + inp.padMove.x;
    const speed = inp.held('run') ? GAMEPLAY.runSpeed : GAMEPLAY.walkSpeed;
    const f = new THREE.Vector3(-Math.sin(this.rig.yaw), 0, -Math.cos(this.rig.yaw));
    const r = new THREE.Vector3().crossVectors(f, UP);
    const want = f.multiplyScalar(fwd).addScaledVector(r, str);
    if (want.lengthSq() > 1) want.normalize();
    want.multiplyScalar(speed);
    // Slow in water/sand/deep rough.
    const s = this.course.surface(this.player.x, this.player.z);
    if (s === 'water') want.multiplyScalar(0.35);
    else if (s === 'sand' || s === 'deepRough') want.multiplyScalar(0.8);
    this.walkVel.lerp(want, 1 - Math.exp(-dt * 10));
    this.player.addScaledVector(this.walkVel, dt);
    const lim = this.field().half - 45;
    this.player.x = Math.max(-lim, Math.min(lim, this.player.x));
    this.player.z = Math.max(-lim, Math.min(lim, this.player.z));
    this.crouch += ((inp.held('crouch') ? 1 : 0) - this.crouch) * Math.min(1, dt * 8);
    const ground = this.course.height(this.player.x, this.player.z);
    const wl = this.course.waterHeight(this.player.x, this.player.z);
    const eyeH = 1.65 - this.crouch * 0.95;
    const eye = new THREE.Vector3(this.player.x, Math.max(ground, wl !== null ? wl - 0.6 : ground) + eyeH, this.player.z);
    this.player.y = ground;
    this.rig.walk(eye, dt);
    this.rangefinderUpdate(dt);

    const dBall = this.distTo(this.ball);
    if (inp.pressed('toggleStance')) {
      if (dBall <= GAMEPLAY.stanceReach) {
        this.suggestPending = true;
        this.enterStance();
      } else this.ui.toast(`Your ball is ${this.fmtDist(dBall)} away — walk there, or press F to go to it`, 'info');
    }
    if (inp.pressed('returnToBall')) this.goToBall();
    if (inp.pressed('freeCam')) {
      this.prevMode = 'walk';
      this.mode = 'freecam';
    }
    this.hint = dBall <= GAMEPLAY.stanceReach ? 'Tab: address the ball' : `WASD walk · Shift run · F go to ball (${this.fmtDist(dBall)}) · RMB rangefinder · Ctrl crouch`;
  }

  private updateFreecam(dt: number) {
    const inp = this.input;
    const look = inp.consumeLookDelta();
    this.rig.yaw -= look.dx * 0.0022;
    this.rig.pitch = Math.max(-1.4, Math.min(1.4, this.rig.pitch - look.dy * 0.0022));
    const k = (a: Parameters<Input['held']>[0]) => (inp.held(a) ? 1 : 0);
    inp.setContext('walk');
    const sp = inp.held('run') ? 60 : 20;
    const move = new THREE.Vector3((k('moveRight') - k('moveLeft')) * sp, (k('jump') - k('crouch')) * sp * 0.5, (k('moveForward') - k('moveBack')) * sp);
    this.rig.free(move, dt);
    this.hint = 'Survey camera — WASD fly · Shift fast · V exit';
    if (inp.pressed('freeCam') || inp.pressed('toggleStance')) {
      if (this.prevMode === 'walk') this.enterWalk();
      else this.enterStance();
    }
  }

  private rangefinderUpdate(dt: number) {
    const on = this.input.held('rangefinder');
    this.rig.fovZoom += ((on && this.mode === 'walk' ? 4 : 1) - this.rig.fovZoom) * Math.min(1, dt * 8);
    if (!on) {
      this.rangefinder = null;
      return;
    }
    const p = this.rig.pickTerrain();
    if (!p) {
      this.rangefinder = { distance: -1, elevation: 0 };
      return;
    }
    const from = this.mode === 'walk' ? this.player : this.ball;
    this.rangefinder = { distance: Math.hypot(p.x - from.x, p.z - from.z), elevation: p.y - this.course.height(from.x, from.z) };
  }

  private fmtDist(m: number) {
    return settings.get('units') === 'yards' ? `${Math.round(m / 0.9144)} yds` : `${Math.round(m)} m`;
  }

  private makeReport(shot: PendingShot, result: ShotReport['result']): ShotReport {
    const d = shot.result.delivery;
    const l = shot.launch;
    const carryP = this.sim.carryPos ?? this.sim.pos;
    const o = shot.origin;
    const a = shot.aimDir;
    const right = new THREE.Vector3().crossVectors(a, UP);
    const end = this.sim.pos;
    const along = (p: THREE.Vector3) => (p.x - o.x) * a.x + (p.z - o.z) * a.z;
    return {
      club: d.club.name,
      clubSpeedMph: d.clubSpeed / MPH,
      face: d.faceAngle,
      path: d.path,
      faceToPath: d.faceAngle - d.path,
      attack: d.attackAngle,
      dynamicLoft: d.dynamicLoft,
      ballSpeedMph: l.ballSpeed / MPH,
      smash: d.clubSpeed > 0 ? l.ballSpeed / d.clubSpeed : 0,
      launchV: l.launchV,
      launchH: l.launchH,
      spinRpm: l.spinRpm,
      spinAxis: l.spinAxis,
      carry: along(carryP),
      total: along(end),
      offline: (end.x - o.x) * right.x + (end.z - o.z) * right.z,
      apex: this.sim.apex - o.y,
      quality: l.quality,
      result,
      practice: false,
    };
  }

  hudView(): HudView {
    const h = HOLES[this.round.current];
    const pin = this.pin;
    const camDir = new THREE.Vector3();
    this.world.camera.getWorldDirection(camDir);
    const camYaw = Math.atan2(camDir.x, -camDir.z);
    const windYaw = Math.atan2(this.wind.dir.x, -this.wind.dir.z);
    const bag = BAG.map((c, i) => ({ index: i, id: c.id, name: c.name, short: c.short, loft: c.loft, typicalCarry: typicalCarry(c.id) }));
    const inStance = this.mode === 'stance' || this.mode === 'swing';
    const from = this.mode === 'walk' ? this.player : this.ball;
    return {
      mode: this.mode,
      holeNumber: h.number,
      holeName: h.name,
      par: h.par,
      strokes: this.round.strokes,
      totalStrokes: this.round.totalStrokes + (this.round.holes[this.round.current].strokes === null ? this.round.strokes : 0),
      toPar: this.round.toPar,
      distanceToPin: Math.hypot(pin.x - from.x, pin.z - from.z),
      elevationToPin: pin.y - this.course.height(from.x, from.z),
      lie: this.lie(),
      windSpeed: this.wind.speed,
      windRelAngle: windYaw - camYaw,
      timer: this.round.timer,
      club: bag[this.swing.clubIndex],
      bag,
      swing: inStance || this.mode === 'flight' ? this.swing.panelView() : null,
      clubPanel: inStance ? this.swing.clubPanelView() : null,
      hint: this.hint,
      rangefinder: this.rangefinder,
      ballInFlight: this.mode === 'flight',
      distanceToBall: this.distTo(this.ball),
      units: settings.get('units'),
      player: { x: this.player.x, z: this.player.z, yaw: this.playerYaw },
      ball: { x: (this.mode === 'flight' ? this.sim.pos : this.ball).x, z: (this.mode === 'flight' ? this.sim.pos : this.ball).z },
      pin: { x: pin.x, z: pin.z },
    };
  }

  /** Hooks for automated Playwright tests. */
  private exposeTestHooks() {
    window.__game = {
      get mode() {
        return game.mode;
      },
      get strokes() {
        return game.round.strokes;
      },
      get hole() {
        return game.round.current;
      },
      get ball() {
        return { x: game.ball.x, y: game.ball.y, z: game.ball.z };
      },
      get swing() {
        const s = game.swing;
        return { face: s.face, path: s.path, aim: s.aim, stance: s.stance, club: s.club.id, active: s.active, hands: { ...s.model.hands }, practice: s.practice };
      },
      get lastReport() {
        return game.lastReport;
      },
      get simState() {
        return game.sim.state;
      },
      start: (hole = 0) => game.startRound(hole, 'round'),
      stats: () => game.world.stats(),
    };
    const game = this;
  }
}

const carryCache: Record<string, number> = { D: 210, '4H': 170, '7I': 140, SW: 85, P: 10 };
function typicalCarry(id: string) {
  return carryCache[id] ?? 0;
}
