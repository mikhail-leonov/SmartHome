/**
 * dorita980 ships no TypeScript types. We use it through a thin `any` wrapper
 * in src/integrations/roomba.ts, so this ambient declaration is enough to keep
 * the compiler happy without pulling in a (non-existent) @types package.
 */
declare module 'dorita980';
