import typescript from '@rollup/plugin-typescript';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

const config = {
    input: 'src/main.ts',
    output: {
        file: 'dist/main.js',
        sourcemap: 'inline',
        format: 'cjs',
        exports: 'default'
    },
    external: ['obsidian'],
    plugins: [
        typescript({ tsconfig: './tsconfig.json' }),
        nodeResolve({ browser: true }),
        commonjs({ extensions: ['.js', '.ts'] })
    ]
};

export default config;
