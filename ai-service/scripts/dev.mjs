import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const service = join(dirname(fileURLToPath(import.meta.url)), '..');
const virtualPython = join(service, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = existsSync(virtualPython) ? virtualPython : process.platform === 'win32' ? 'python' : 'python3';
const child = spawn(python, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000', '--reload'], { cwd: service, stdio: 'inherit' });
child.on('error', error => { console.error(`Không khởi động được AI service: ${error.message}`); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
