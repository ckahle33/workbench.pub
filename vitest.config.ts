import { defineConfig } from 'vitest/config';
import projects from './vitest.workspace.ts';

export default defineConfig({ test: { projects } });
