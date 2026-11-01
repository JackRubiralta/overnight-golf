/// <reference lib="webworker" />
import { CourseField } from '../course/CourseField';

const field = new CourseField();
self.onmessage = (e: MessageEvent<{ res: number; row0: number; row1: number }>) => {
  const { res, row0, row1 } = e.data;
  const out = field.bakeRows(res, row0, row1);
  (self as unknown as Worker).postMessage({ row0, row1, ...out }, [out.heights.buffer, out.maskA.buffer, out.maskB.buffer]);
};
