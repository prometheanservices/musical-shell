#!/usr/bin/env node

const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFile } = require('child_process');

// Frequencies (in Hz) across 3 octaves (C4, C5, and C6)
const NOTES = {
  // Middle Octave (C4 - B4)
  do: 261.63,
  re: 293.66,
  mi: 329.63,
  fa: 349.23,
  sol: 392.00,
  la: 440.00,
  si: 493.88,

  // High Octave (C5 - B5)
  do2: 523.25,
  re2: 587.33,
  mi2: 659.25,
  fa2: 698.46,
  sol2: 783.99,
  la2: 880.00,
  si2: 987.77,

  // Very High Octave (C6 - E6)
  do3: 1046.50,
  re3: 1174.66,
  mi3: 1318.51
};

let currentBpm = 120;
const getBeatDurationMs = () => Math.round(60000 / currentBpm);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Persistent Windows PowerShell player (eliminates per-note startup lag)
let psPlayer = null;
let psQueue = [];

if (os.platform() === 'win32') {
  psPlayer = spawn('powershell', ['-NoProfile', '-NoLogo', '-Command', '-'], {
    stdio: ['pipe', 'pipe', 'ignore']
  });

  psPlayer.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split(/\r?\n/);
    for (const line of lines) {
      if (line.trim() === 'DONE' && psQueue.length > 0) {
        const resolve = psQueue.shift();
        resolve();
      }
    }
  });
}

// Plays a WAV file with accurate timing
function playAudioFile(filePath) {
  const platform = os.platform();

  if (platform === 'win32' && psPlayer) {
    return new Promise((resolve) => {
      psQueue.push(resolve);
      const safePath = filePath.replace(/'/g, "''");
      psPlayer.stdin.write(
        `(New-Object Media.SoundPlayer '${safePath}').PlaySync(); Write-Output 'DONE'\n`
      );
    });
  }

  return new Promise((resolve, reject) => {
    if (platform === 'darwin') {
      execFile('afplay', [filePath], (err) => (err ? reject(err) : resolve()));
    } else {
      execFile('aplay', [filePath], (err) => (err ? reject(err) : resolve()));
    }
  });
}

async function playNote(freq, durationMs) {
  const sampleRate = 44100;
  const numSamples = Math.floor((sampleRate * durationMs) / 1000);
  const buffer = Buffer.alloc(44 + numSamples * 2);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + numSamples * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(numSamples * 2, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, (numSamples - i) / (sampleRate * 0.03));
    const sample = Math.sin(2 * Math.PI * freq * t) * 0.5 * envelope;
    buffer.writeInt16LE(Math.floor(sample * 32767), 44 + i * 2);
  }

  const tempFile = path.join(os.tmpdir(), `note_${freq}_${durationMs}.wav`);
  if (!fs.existsSync(tempFile)) {
    fs.writeFileSync(tempFile, buffer);
  }
  await playAudioFile(tempFile);
}

async function runSequence(input) {
  const tokens = input.trim().toLowerCase().split(/\s+/);

  for (const token of tokens) {
    if (!token) continue;

    // 1. Match tempo(bpm) or bpm(number)
    const tempoMatch = token.match(/^(?:tempo|bpm)\((\d+)\)$/);
    if (tempoMatch) {
      const newBpm = parseInt(tempoMatch[1], 10);
      if (newBpm >= 20 && newBpm <= 600) {
        currentBpm = newBpm;
        console.log(`⏱ Tempo set to ${currentBpm} BPM (${getBeatDurationMs()}ms per note)`);
      } else {
        console.log(`! Please choose a BPM between 20 and 600.`);
      }
      continue;
    }

    // 2. Match sleep(milliseconds)
    const sleepMatch = token.match(/^sleep\((\d+)\)$/);
    if (sleepMatch) {
      const ms = parseInt(sleepMatch[1], 10);
      console.log(`⏸ Sleeping for ${ms}ms...`);
      await sleep(ms);
      continue;
    }

    // 3. Match musical notes
    if (NOTES[token]) {
      const duration = getBeatDurationMs();
      console.log(`♪ Playing ${token} (${NOTES[token]} Hz) [${currentBpm} BPM]`);
      await playNote(NOTES[token], duration);
    } else {
      console.log(`? Unknown command: "${token}"`);
    }
  }
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'synth> '
});

console.log('Terminal Synth Ready!');
console.log('Middle Octave: do, re, mi, fa, sol, la, si');
console.log('High Octaves:  do2, re2, mi2, fa2, sol2, la2, si2, do3, re3, mi3');
console.log('Commands:      tempo(bpm) | sleep(ms) | exit\n');

rl.prompt();

rl.on('line', async (line) => {
  if (line.trim().toLowerCase() === 'exit') {
    rl.close();
    return;
  }
  await runSequence(line);
  rl.prompt();
}).on('close', () => {
  if (psPlayer) psPlayer.kill();
  process.exit(0);
});
