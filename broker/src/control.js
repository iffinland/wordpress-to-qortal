import { createConnection } from 'node:net';

const [socketPath, command, payload = '{}'] = process.argv.slice(2);
if (!socketPath || !command) {
  process.stderr.write('Usage: node src/control.js <admin.sock> <status|disable|enable|revoke-key|unrevoke-key> [json]\n');
  process.exit(2);
}
let message;
try {
  message = JSON.parse(payload);
} catch {
  process.stderr.write('The payload must be JSON.\n');
  process.exit(2);
}
message.command = command;
const socket = createConnection(socketPath);
let buffer = '';
socket.setEncoding('utf8');
socket.setTimeout(10000, () => {
  process.stderr.write('admin socket timeout\n');
  process.exit(1);
});
socket.on('connect', () => socket.write(JSON.stringify(message) + '\n'));
socket.on('data', (chunk) => {
  buffer += chunk;
  if (buffer.includes('\n')) {
    socket.end();
    process.stdout.write(buffer.trim() + '\n');
  }
});
socket.on('error', (error) => {
  process.stderr.write('admin socket error: ' + error.message + '\n');
  process.exit(1);
});
