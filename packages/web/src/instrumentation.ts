/**
 * Next.js looks for this file at `src/instrumentation.ts` when a `src/`
 * directory exists. It forwards to the package-root `instrumentation.ts`
 * so we have a single canonical definition of `register` and
 * `onRequestError`.
 */
export { register, onRequestError } from '../instrumentation';
