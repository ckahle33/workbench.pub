import { createApp } from './app';

// Worker entry: export ONLY the default handler. The Workers runtime rejects any other runtime
// export (e.g. a constant) at startup; see functions/entryExports.test.ts.
export default createApp();
