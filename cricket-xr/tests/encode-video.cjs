const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

const eventsFile = path.resolve('audio-events.json');
if (!fs.existsSync(eventsFile)) {
  console.error('audio-events.json not found!');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(eventsFile, 'utf8'));
const fps = data.fps || 24;
const totalDuration = (data.totalFrames / fps).toFixed(2);

console.log(`Building video for ${data.totalFrames} frames at ${fps} FPS (~${totalDuration}s)...`);

const audioMap = {
  ui: 'public/audio/ui.ogg',
  hit: 'public/audio/hit.ogg',
  caught: 'public/audio/confirm.ogg',
  missed: 'public/audio/hurt.ogg',
  over: 'public/audio/level_up.ogg',
};

// Check if audio files exist
const validEvents = data.events.filter((e) => audioMap[e.type] && fs.existsSync(audioMap[e.type]));

let ffmpegCmd = '';
if (validEvents.length === 0) {
  ffmpegCmd = `ffmpeg -y -framerate ${fps} -i hd-preview-frames/f%04d.png -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p cricket_catch_30s_hd.mp4`;
} else {
  const inputs = [`-framerate ${fps} -i hd-preview-frames/f%04d.png`];
  const filterParts = [];
  const mixInputs = [];

  validEvents.forEach((ev, idx) => {
    inputs.push(`-i "${audioMap[ev.type]}"`);
    const delayMs = Math.round((ev.frame / fps) * 1000);
    const audioIdx = idx + 1;
    filterParts.push(`[${audioIdx}:a]adelay=${delayMs}|${delayMs}[a${idx}]`);
    mixInputs.push(`[a${idx}]`);
  });

  const filterComplex = `${filterParts.join(';')};${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=longest[aout]`;

  ffmpegCmd = `ffmpeg -y ${inputs.join(' ')} -filter_complex "${filterComplex}" -map 0:v -map "[aout]" -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p -c:a aac -b:a 192k -t ${totalDuration} cricket_catch_30s_hd.mp4`;
}

console.log('Running ffmpeg...');
try {
  execSync(ffmpegCmd, { stdio: 'inherit' });
  console.log('Successfully generated cricket_catch_30s_hd.mp4!');
} catch (err) {
  console.error('Error running ffmpeg:', err.message);
  console.log('Trying fallback video-only encode...');
  execSync(`ffmpeg -y -framerate ${fps} -i hd-preview-frames/f%04d.png -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p cricket_catch_30s_hd.mp4`, { stdio: 'inherit' });
}

