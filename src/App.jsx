import React, { useEffect, useRef, useState, useCallback } from 'react';

// ==========================================
// 輔助函數：色碼轉換
// ==========================================
const hexToRgb = (hex) => {
  const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
  hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 255, g: 255, b: 255 };
};

// ==========================================
// Gemini API 整合設定
// ==========================================
// ⚠️ 注意：請在發佈到 GitHub 之前，確保您的 API Key 不會被公開洩漏。
// 建議使用環境變數 import.meta.env.VITE_GEMINI_API_KEY 來處理。
const apiKey = import.meta.env.VITE_GEMINI_API_KEY || ""; 

const fetchWithRetry = async (url, options, retries = 5) => {
  const delays = [1000, 2000, 4000, 8000, 16000];
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return await res.json();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, delays[i]));
    }
  }
};

const generateAIFireworkConfig = async (prompt) => {
  if (!apiKey) {
      throw new Error("API Key 尚未設定！請在環境變數中設定 VITE_GEMINI_API_KEY");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  
  const systemPrompt = `你是一位充滿詩意的日本夏祭花火大師與物理工程師。請根據使用者的描述，設計出一款專屬煙火的物理參數，並為它寫一句優美的繁體中文短詩（俳句風格）。顏色請使用 HEX 色碼 (如 #ff0055)。
soundType 只能是: "normal" (一般), "crackle" (碎裂劈啪聲), "shakudama" (震撼重低音)。
【極度重要指示】：
1. 判斷使用者描述的形狀。可選：'sphere', 'heart', 'cat', 'star', 'smiley', 'cross', 'pinwheel', 'nova', 'comet', 'waterfall', 'palm'。若為圖案請強制將 linger 設為 true！
2. clusterLaunch：若使用者描述「齊發」、「連發」、「瀑布」、「流星雨」、「好幾發」，請設為 true，將會一次發射多枚煙火創造壯觀排場！
3. 十字架請用 'cross'，風車/螺旋請用 'pinwheel'，擴散衝擊波請用 'nova'，流星/彗星請用 'comet'，流金瀑布請用 'waterfall'，棕櫚樹/椰子樹請用 'palm'。`;

  const schema = {
    type: "OBJECT",
    properties: {
      name: { type: "STRING", description: "這顆花火的優美名稱" },
      poem: { type: "STRING", description: "搭配這顆花火的繁體中文短詩（約10-15字，可用逗號分隔）" },
      shape: { type: "STRING", description: "煙火形狀。可選：'sphere', 'heart', 'cat', 'star', 'smiley', 'cross', 'pinwheel', 'nova', 'comet', 'waterfall', 'palm'" },
      colors: { type: "ARRAY", items: { type: "STRING" }, description: "花火粒子的顏色陣列，2到5種顏色" },
      dualColor: { type: "BOOLEAN", description: "是否具備雙色漸變效果（燃燒過程中變換顏色）" },
      clusterLaunch: { type: "BOOLEAN", description: "是否以集束方式發射（一次發射多發煙火，適合瀑布或壯觀排場）" },
      particleCount: { type: "INTEGER", description: "單發粒子數量，範圍 50 到 350" },
      speedMultiplier: { type: "NUMBER", description: "爆炸擴散速度倍率，0.5 到 3.0" },
      gravity: { type: "NUMBER", description: "重力影響，0.0 到 0.3（若是圖案煙火請設為0）" },
      friction: { type: "NUMBER", description: "空氣阻力，0.85 到 0.99" },
      decay: { type: "NUMBER", description: "粒子消失的速度，0.005 到 0.03" },
      trailLength: { type: "INTEGER", description: "殘影尾巴的長度，0 到 40" },
      flicker: { type: "BOOLEAN", description: "粒子是否會閃爍" },
      linger: { type: "BOOLEAN", description: "粒子是否會在爆炸後懸浮於夜空。若是具體形狀、圖案、十字架，請設為 true。" },
      soundType: { type: "STRING", description: "爆炸音效類型" }
    },
    required: ["name", "poem", "shape", "colors", "dualColor", "clusterLaunch", "particleCount", "speedMultiplier", "gravity", "friction", "decay", "trailLength", "flicker", "linger", "soundType"]
  };

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema
    }
  };

  const data = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textResponse) throw new Error("無效的 API 回應");
  return JSON.parse(textResponse);
};

// ==========================================
// 音效合成引擎 (Web Audio API)
// ==========================================
class AudioEngine {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 1.0; 
    this.masterGain.connect(this.ctx.destination);
    
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.4; 
    this.bgmGain.connect(this.masterGain);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.7;
    this.sfxGain.connect(this.masterGain);

    this.initialized = false;
    this.bgmPlaying = false;
    this.bgmTimer = null;
  }

  init() {
    if (!this.initialized) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.initialized = true;
    }
  }

  setBgmVolume(val) {
    if (!this.initialized) return;
    this.bgmGain.gain.linearRampToValueAtTime(val, this.ctx.currentTime + 0.1);
  }

  setSfxVolume(val) {
    if (!this.initialized) return;
    this.sfxGain.gain.linearRampToValueAtTime(val, this.ctx.currentTime + 0.1);
  }

  startBGM() {
    if (!this.initialized || this.bgmPlaying) return;
    this.bgmPlaying = true;
    
    const bpm = 120;
    const beatDur = 60 / bpm;
    const eighthNoteDur = beatDur / 2;
    const freqs = [349.23, 415.30, 466.16, 523.25, 622.25, 698.46, 830.61, 932.33, 1046.50];

    const p1 = [0, 2, 3, 2,  5, 3, 2, 0];
    const p2 = [2, 3, 4, 3,  2, 0, -1, -1];
    const p3 = [0, 2, 3, 5,  6, 5, 3, 2];
    const p4 = [0, 2, -1, 0, -1, -1, -1, -1];
    const p5 = [6, 5, 3, 2,  3, 5, 6, -1];
    const p6 = [8, 6, 5, 3,  2, 0, 2, -1];

    const fullMelody = [
      ...p1, ...p2, ...p1, ...p4,
      ...p3, ...p5, ...p6, ...p4,
      ...p1, ...p2, ...p1, ...p4,
      ...p3, ...p5, ...p6, ...p4
    ];

    let nextNoteTime = this.ctx.currentTime + 0.1;
    let notePos = 0;

    const playSynthTaiko = (time, freq, vol) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.frequency.setValueAtTime(freq, time);
      osc.frequency.exponentialRampToValueAtTime(freq/2, time + 0.4);
      gain.gain.setValueAtTime(vol, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.4);
      osc.connect(gain); gain.connect(this.bgmGain); 
      osc.start(time); osc.stop(time + 0.5);
    };

    const playSynthBell = (time, freq, vol) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(vol, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 2000;
      osc.connect(filter); filter.connect(gain); gain.connect(this.bgmGain); 
      osc.start(time); osc.stop(time + 0.3);
    };

    const playShinobue = (time, freq) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(0.08, time + 0.05);
      gain.gain.linearRampToValueAtTime(0.05, time + eighthNoteDur - 0.05);
      gain.gain.linearRampToValueAtTime(0, time + eighthNoteDur);
      osc.connect(gain); gain.connect(this.bgmGain); 
      osc.start(time); osc.stop(time + eighthNoteDur);
    };

    const schedule = () => {
      if (!this.bgmPlaying) return;
      while (nextNoteTime < this.ctx.currentTime + 0.1) {
        if (notePos % 4 === 0) playSynthTaiko(nextNoteTime, 60, 0.25);
        else if (notePos % 4 === 2) playSynthTaiko(nextNoteTime, 90, 0.1);
        if (notePos % 2 === 1 && Math.random() > 0.6) playSynthTaiko(nextNoteTime, 100, 0.05);
        if (notePos % 4 === 2) playSynthBell(nextNoteTime, 800, 0.03);
        
        const noteIndex = fullMelody[notePos];
        if (noteIndex !== -1) playShinobue(nextNoteTime, freqs[noteIndex]);

        notePos++;
        if (notePos >= fullMelody.length) notePos = 0;
        nextNoteTime += eighthNoteDur;
      }
      this.bgmTimer = setTimeout(schedule, 25);
    };
    schedule();
  }

  playLaunchSound() {
    if (!this.initialized) return;
    const time = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(250, time);
    osc.frequency.exponentialRampToValueAtTime(1000, time + 1.5);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.08, time + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, time + 1.5);
    osc.connect(gain); gain.connect(this.sfxGain); 
    osc.start(time); osc.stop(time + 1.5);

    const bufferSize = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 3000;
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0, time);
    noiseGain.gain.linearRampToValueAtTime(0.05, time + 0.1);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, time + 1.5);

    noise.connect(noiseFilter); noiseFilter.connect(noiseGain); noiseGain.connect(this.sfxGain);
    noise.start(time);
  }

  playExplosionSound(type = 'normal') {
    if (!this.initialized) return;
    const time = this.ctx.currentTime;
    
    const bufferSize = this.ctx.sampleRate * 2.5; 
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const filter = this.ctx.createBiquadFilter();
    const gain = this.ctx.createGain();

    if (type === 'shakudama') {
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(400, time); 
      filter.frequency.linearRampToValueAtTime(50, time + 2);
      gain.gain.setValueAtTime(1.5, time); 
      gain.gain.exponentialRampToValueAtTime(0.01, time + 2.5);

      const subOsc = this.ctx.createOscillator();
      const subGain = this.ctx.createGain();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(100, time);
      subOsc.frequency.exponentialRampToValueAtTime(30, time + 1.5);
      subGain.gain.setValueAtTime(1, time);
      subGain.gain.exponentialRampToValueAtTime(0.01, time + 2);
      subOsc.connect(subGain); subGain.connect(this.sfxGain);
      subOsc.start(time); subOsc.stop(time + 2.5);

    } else if (type === 'crackle') {
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2500, time);
      gain.gain.setValueAtTime(0.4, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.5);
    } else {
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1000, time);
      filter.frequency.linearRampToValueAtTime(100, time + 1);
      gain.gain.setValueAtTime(0.6, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 1.2);
    }

    noise.connect(filter); filter.connect(gain); gain.connect(this.sfxGain);
    noise.start(time);
  }
}

const audio = new AudioEngine();

// ==========================================
// 粒子與煙火物理引擎
// ==========================================
const COLORS = [
  '#ff3366', '#33ccff', '#ff9933', '#66ff66', 
  '#cc33ff', '#ffffff', '#ffd700', '#ff0055'
];

class Particle {
  constructor(x, y, vx, vy, color, options = {}) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    
    this.initialAlpha = 1;
    this.alpha = 1;
    this.color = color;
    this.rgb1 = hexToRgb(color);
    this.endColor = options.endColor || null;
    if (this.endColor) {
      this.rgb2 = hexToRgb(this.endColor);
    }

    this.friction = options.friction || 0.95; 
    this.gravity = options.gravity !== undefined ? options.gravity : 0.2;
    this.decay = options.decay || (Math.random() * 0.015 + 0.015);
    this.size = options.size || Math.random() * 2 + 1;
    this.trail = [];
    this.trailLength = options.trailLength || 5;
    this.flicker = options.flicker || false;
    
    this.linger = options.linger || false;
    this.lingerDelay = options.lingerDelay || 0; 
    this.lingerTimer = options.lingerTimer || 150; 
  }

  update() {
    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > this.trailLength) this.trail.shift();
    
    if (this.linger) {
      if (this.lingerDelay > 0) {
        this.lingerDelay--;
        this.vx *= this.friction;
        this.vy *= this.friction;
        this.vy += this.gravity; 
        this.x += this.vx;
        this.y += this.vy;
      } else {
        this.vx *= 0.8;
        this.vy *= 0.8;
        this.x += this.vx;
        this.y += this.vy;
        
        if (Math.abs(this.vx) < 0.1 && Math.abs(this.vy) < 0.1) {
          this.lingerTimer--;
          if (this.lingerTimer <= 0) {
            this.alpha -= this.decay; 
          }
        }
      }
    } else {
      this.vx *= this.friction;
      this.vy *= this.friction;
      this.vy += this.gravity;
      this.x += this.vx;
      this.y += this.vy;
      this.alpha -= this.decay;
    }
  }

  draw(ctx) {
    if (this.alpha <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    let drawColor = this.color;
    if (this.rgb2) {
      const progress = Math.max(0, this.alpha / this.initialAlpha); 
      const r = Math.round(this.rgb1.r * progress + this.rgb2.r * (1 - progress));
      const g = Math.round(this.rgb1.g * progress + this.rgb2.g * (1 - progress));
      const b = Math.round(this.rgb1.b * progress + this.rgb2.b * (1 - progress));
      drawColor = `rgb(${r}, ${g}, ${b})`;
    }
    
    if (this.trail.length > 0) {
      ctx.beginPath();
      ctx.moveTo(this.trail[0].x, this.trail[0].y);
      for (let i = 1; i < this.trail.length; i++) ctx.lineTo(this.trail[i].x, this.trail[i].y);
      ctx.strokeStyle = drawColor;
      ctx.lineWidth = this.size;
      ctx.globalAlpha = this.alpha * 0.5;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fillStyle = drawColor;
    ctx.globalAlpha = this.flicker ? Math.random() * this.alpha : this.alpha;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * 3, 0, Math.PI * 2);
    ctx.fillStyle = drawColor;
    ctx.globalAlpha = this.alpha * 0.05;
    ctx.fill();
    ctx.restore();
  }
}

class Firework {
  constructor(canvas, x, startY, targetY, type, aiConfig = null) {
    this.canvas = canvas;
    this.x = x;
    this.y = startY;
    this.targetY = targetY;
    this.type = type;
    this.aiConfig = aiConfig;
    
    const height = Math.max(10, this.y - this.targetY);
    this.vy = -Math.sqrt(2 * 0.18 * height);
    
    const centerX = canvas.width / 2;
    const dirX = (centerX - this.x) * 0.002;
    this.vx = dirX + (Math.random() - 0.5) * 3;
    
    this.exploded = false;
    this.color = COLORS[Math.floor(Math.random() * COLORS.length)];
    this.endColor = Math.random() > 0.4 ? COLORS[Math.floor(Math.random() * COLORS.length)] : null;
    this.trail = [];
    
    audio.playLaunchSound();
  }

  update(addParticles, screenShake) {
    if (!this.exploded) {
      this.trail.push({ x: this.x, y: this.y });
      if (this.trail.length > 8) this.trail.shift();

      this.vy += 0.18; 
      this.x += this.vx;
      this.y += this.vy;

      if (this.vy >= 0) {
        this.explode(addParticles, screenShake);
      }
    }
  }

  draw(ctx) {
    if (!this.exploded && this.trail.length > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(this.trail[0].x, this.trail[0].y);
      for (let i = 1; i < this.trail.length; i++) ctx.lineTo(this.trail[i].x, this.trail[i].y);
      ctx.strokeStyle = '#ffaa55';
      ctx.lineWidth = 3;
      ctx.globalCompositeOperation = 'lighter';
      ctx.stroke();
      ctx.restore();
    }
  }

  explode(addParticles, screenShake) {
    this.exploded = true;
    let particleCount = 0;

    const createParticle = (vx, vy, color, options) => {
      addParticles(new Particle(this.x, this.y, vx, vy, color, options));
    };

    if (this.aiConfig) {
      audio.playExplosionSound(this.aiConfig.soundType || 'normal');
      if (this.aiConfig.soundType === 'shakudama') screenShake(25);
      
      const count = Math.min(400, Math.max(50, this.aiConfig.particleCount || 100));
      const safeMultiplier = Math.min(3.0, Math.max(0.8, this.aiConfig.speedMultiplier || 1.2));
      const safeFriction = Math.min(0.98, Math.max(0.85, this.aiConfig.friction || 0.95)); 
      const actualGravity = this.aiConfig.linger ? 0 : Math.min(0.25, Math.max(-0.05, this.aiConfig.gravity !== undefined ? this.aiConfig.gravity : 0.15));
      
      const shape = this.aiConfig.shape || 'sphere'; 

      const getAIColor = () => this.aiConfig.colors[Math.floor(Math.random() * this.aiConfig.colors.length)];
      const getAIEndColor = () => (this.aiConfig.dualColor && this.aiConfig.colors.length > 1) ? this.aiConfig.colors[Math.floor(Math.random() * this.aiConfig.colors.length)] : null;
      
      const aiBaseOptions = (isShape) => ({
        endColor: getAIEndColor(),
        friction: safeFriction,
        gravity: actualGravity,
        decay: this.aiConfig.decay || (Math.random() * 0.015 + 0.01), 
        trailLength: this.aiConfig.trailLength || 5,
        flicker: this.aiConfig.flicker || false,
        linger: this.aiConfig.linger || false, 
        lingerDelay: (this.aiConfig.linger && isShape) ? 25 : (this.aiConfig.linger ? 10 : 0), 
        size: Math.random() * 1.0 + (isShape ? 1.5 : 0.6)
      });

      if (['heart', 'cat', 'star', 'smiley', 'cross', 'pinwheel', 'palm'].includes(shape)) {
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = Math.random() * 4 + 2;
          createParticle(Math.cos(a)*s, Math.sin(a)*s, '#ffffff', { decay: 0.04 });
        }
      }

      if (shape === 'heart') {
        for (let i = 0; i < Math.PI * 2; i += 0.05) {
          const vx = 16 * Math.pow(Math.sin(i), 3) * 0.9 * safeMultiplier;
          const vy = -(13 * Math.cos(i) - 5 * Math.cos(2 * i) - 2 * Math.cos(3 * i) - Math.cos(4 * i)) * 0.9 * safeMultiplier;
          createParticle(vx, vy, getAIColor(), aiBaseOptions(true));
        }
      } else if (shape === 'cat') {
        const cScale = 7 * safeMultiplier; 
        const catPoints = [];
        for(let i=0; i<Math.PI*2; i+=0.1) catPoints.push({x: Math.cos(i)*cScale, y: Math.sin(i)*cScale});
        for(let t=0; t<=1; t+=0.1){
           catPoints.push({x: (-0.7 - 0.1*t)*cScale, y: (-0.7 - 0.8*t)*cScale});
           catPoints.push({x: (-0.3 - 0.5*t)*cScale, y: (-0.9 - 0.6*t)*cScale});
           catPoints.push({x: (0.3 + 0.5*t)*cScale, y: (-0.9 - 0.6*t)*cScale}); 
           catPoints.push({x: (0.7 + 0.1*t)*cScale, y: (-0.7 - 0.8*t)*cScale}); 
        }
        for(let t=0; t<=1; t+=0.15){
           catPoints.push({x: (-0.8 - 0.6*t)*cScale, y: (-0.1 - 0.2*t)*cScale}); 
           catPoints.push({x: (-0.8 - 0.6*t)*cScale, y: (0.1 + 0.0*t)*cScale});   
           catPoints.push({x: (-0.8 - 0.6*t)*cScale, y: (0.3 + 0.2*t)*cScale});   
           catPoints.push({x: (0.8 + 0.6*t)*cScale, y: (-0.1 - 0.2*t)*cScale});   
           catPoints.push({x: (0.8 + 0.6*t)*cScale, y: (0.1 + 0.0*t)*cScale});    
           catPoints.push({x: (0.8 + 0.6*t)*cScale, y: (0.3 + 0.2*t)*cScale});    
        }
        for(let a=0; a<Math.PI*2; a+=0.5) {
           catPoints.push({x: -0.3*cScale + Math.cos(a)*0.2, y: -0.2*cScale + Math.sin(a)*0.2});
           catPoints.push({x: 0.3*cScale + Math.cos(a)*0.2, y: -0.2*cScale + Math.sin(a)*0.2});
        }
        catPoints.forEach(pt => createParticle(pt.x, pt.y, getAIColor(), aiBaseOptions(true)));
      } else if (shape === 'star') {
        const sScale = 9 * safeMultiplier; 
        for (let i = 0; i < 5; i++) {
          const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
          const nextAngle = ((i + 1) * 4 * Math.PI) / 5 - Math.PI / 2;
          for (let j = 0; j < 1; j += 0.05) {
            const vx = (Math.cos(angle) * (1 - j) + Math.cos(nextAngle) * j) * sScale;
            const vy = (Math.sin(angle) * (1 - j) + Math.sin(nextAngle) * j) * sScale;
            createParticle(vx, vy, getAIColor(), aiBaseOptions(true));
          }
        }
      } else if (shape === 'smiley') {
        const smScale = 2.5 * safeMultiplier;
        const facePoints = [];
        for(let i=0; i<Math.PI*2; i+=0.15) facePoints.push({x: Math.cos(i)*4, y: Math.sin(i)*4});
        facePoints.push({x: -1.5, y: -1.5}); facePoints.push({x: 1.5, y: -1.5});
        for(let i=Math.PI*0.2; i<=Math.PI*0.8; i+=0.1) facePoints.push({x: Math.cos(i)*2.5, y: Math.sin(i)*2.5});
        facePoints.forEach(pt => createParticle(pt.x * smScale, pt.y * smScale, getAIColor(), aiBaseOptions(true)));
      } else if (shape === 'cross') {
        const cScale = 1.0 * safeMultiplier; 
        for (let i = -15; i <= 15; i++) {
          createParticle(i * cScale, 0, getAIColor(), aiBaseOptions(true));
        }
        for (let i = -10; i <= 25; i++) {
          createParticle(0, i * cScale, getAIColor(), aiBaseOptions(true));
        }
      } else if (shape === 'pinwheel') {
        const arms = 6;
        for (let a = 0; a < arms; a++) {
          const baseAngle = (a / arms) * Math.PI * 2;
          for (let j = 1; j <= 25; j++) {
            const spd = j * 0.4 * safeMultiplier;
            const ang = baseAngle + j * 0.1; 
            const opts = aiBaseOptions(true);
            opts.decay = (opts.decay || 0.015) * 0.8;
            opts.gravity = 0; 
            createParticle(Math.cos(ang)*spd, Math.sin(ang)*spd, getAIColor(), opts);
          }
        }
      } else if (shape === 'nova') {
        for(let i=0; i<150; i++){
          const a = Math.random() * Math.PI * 2;
          const s = (Math.random() * 3 + 1) * safeMultiplier;
          const iceColor = Math.random() > 0.5 ? '#ffffff' : '#00ffff';
          createParticle(Math.cos(a)*s, Math.sin(a)*s, iceColor, { ...aiBaseOptions(false), decay: 0.02, size: 2 });
        }
        const numCones = 8 + Math.floor(Math.random() * 4); 
        for(let c=0; c<numCones; c++){
          const baseAngle = (c / numCones) * Math.PI * 2;
          for(let i=0; i<20; i++){
            const a = baseAngle + (Math.random() - 0.5) * 0.3;
            const s = (Math.random() * 8 + 12) * safeMultiplier;
            createParticle(Math.cos(a)*s, Math.sin(a)*s, getAIColor(), { ...aiBaseOptions(false), friction: 0.92, trailLength: 15, decay: 0.015 });
          }
        }
      } else if (shape === 'comet') {
        const cometAngle = -Math.PI / 4 + (Math.random() - 0.5); 
        const cometSpeed = (12 + Math.random() * 4) * safeMultiplier;
        createParticle(Math.cos(cometAngle)*cometSpeed, Math.sin(cometAngle)*cometSpeed, getAIColor(), {
          ...aiBaseOptions(false), friction: 0.99, gravity: 0.05, size: 5, decay: 0.005, trailLength: 40, flicker: true
        });
        for(let i=0; i<15; i++) {
           const offsetAngle = cometAngle + (Math.random() - 0.5) * 0.2;
           const offsetSpeed = cometSpeed * (0.8 + Math.random() * 0.2);
           createParticle(Math.cos(offsetAngle)*offsetSpeed, Math.sin(offsetAngle)*offsetSpeed, getAIColor(), {
             ...aiBaseOptions(false), friction: 0.98, gravity: 0.05, size: 2, decay: 0.01, trailLength: 30
           });
        }
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = Math.random() * 4;
          createParticle(Math.cos(a) * s, Math.sin(a) * s, '#ffffff', { decay: 0.03, trailLength: 5 });
        }
      } else if (shape === 'waterfall') {
        for(let i=0; i<120; i++){
           const vx = (Math.random() - 0.5) * 4 * safeMultiplier;
           const vy = (Math.random() * 4 + 1) * safeMultiplier; 
           createParticle(vx, vy, getAIColor(), { ...aiBaseOptions(false), gravity: 0.25, decay: 0.003, trailLength: 20 });
        }
      } else if (shape === 'palm') {
        const arms = 6 + Math.floor(Math.random() * 3); 
        for (let a = 0; a < arms; a++) {
            const baseAngle = (a / arms) * Math.PI * 2 + (Math.random() * 0.2 - 0.1);
            for (let j = 1; j <= 20; j++) {
                const spd = (j * 0.5 + 2) * safeMultiplier; 
                createParticle(Math.cos(baseAngle)*spd, Math.sin(baseAngle)*spd, getAIColor(), {
                    ...aiBaseOptions(false), trailLength: 15, decay: 0.012, friction: 0.94
                });
            }
        }
      } else {
        for (let i = 0; i < count; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speedFactor = 0.5 + 0.5 * Math.sqrt(Math.random());
          const maxSpeed = (Math.random() * 5 + 9) * safeMultiplier; 
          const speed = speedFactor * maxSpeed;
          createParticle(Math.cos(angle) * speed, Math.sin(angle) * speed, getAIColor(), aiBaseOptions(false));
        }
      }
      return;
    }

    switch (this.type) {
      case '牡丹 (Peony)': 
        particleCount = 100;
        audio.playExplosionSound('normal');
        for (let i = 0; i < particleCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 6 + 2;
          createParticle(Math.cos(angle) * speed, Math.sin(angle) * speed, this.color, { endColor: this.endColor, friction: 0.9, decay: 0.02, trailLength: 2 });
        }
        break;

      case '菊花 (Chrysanthemum)': 
        particleCount = 150;
        audio.playExplosionSound('normal');
        for (let i = 0; i < particleCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 7 + 1;
          createParticle(Math.cos(angle) * speed, Math.sin(angle) * speed, this.color, { endColor: this.endColor, friction: 0.96, decay: 0.01, trailLength: 15 });
        }
        break;

      case '柳樹 (Willow)': 
        particleCount = 180; 
        audio.playExplosionSound('crackle');
        for (let i = 0; i < particleCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 9 + 4; 
          createParticle(Math.cos(angle) * speed, Math.sin(angle) * speed, '#ffd700', { endColor: '#ffffff', friction: 0.92, gravity: 0.15, decay: 0.005, trailLength: 20, flicker: true });
        }
        break;

      case '棕櫚樹 (Palm)':
        audio.playExplosionSound('shakudama');
        const pArms = 6 + Math.floor(Math.random() * 3); 
        for (let a = 0; a < pArms; a++) {
            const angle = (a / pArms) * Math.PI * 2 + (Math.random() * 0.2 - 0.1);
            for (let i = 0; i < 20; i++) {
                const speed = (i * 0.5) + 2; 
                createParticle(Math.cos(angle) * speed, Math.sin(angle) * speed, '#00ff44', {
                    endColor: '#aaffaa', friction: 0.94, gravity: 0.15, decay: 0.012, trailLength: 15, flicker: true, size: 2.5
                });
            }
        }
        for (let i = 0; i < 30; i++) {
            createParticle((Math.random()-0.5)*4, (Math.random()-0.5)*4, '#ffffff', { decay: 0.03, trailLength: 5 });
        }
        break;

      case '尺玉 (Shakudama)': 
        audio.playExplosionSound('shakudama');
        screenShake(30); 
        for (let i = 0; i < 150; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 6;
          createParticle(Math.cos(angle) * speed, Math.sin(angle) * speed, '#ffffff', { endColor: '#aaccff', friction: 0.9, decay: 0.015 });
        }
        for (let i = 0; i < 300; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 20 + 5; 
          createParticle(Math.cos(angle) * speed, Math.sin(angle) * speed, '#ffaa00', { endColor: '#ff0033', friction: 0.92, gravity: 0.05, decay: 0.005, trailLength: 25 });
        }
        break;

      case '愛心 (Heart)':
        audio.playExplosionSound('shakudama');
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = Math.random() * 4 + 2;
          createParticle(Math.cos(a)*s, Math.sin(a)*s, '#ffffff', { decay: 0.04, trailLength: 2 });
        }
        for (let i = 0; i < Math.PI * 2; i += 0.05) {
          const vx = 16 * Math.pow(Math.sin(i), 3) * 0.9;
          const vy = -(13 * Math.cos(i) - 5 * Math.cos(2 * i) - 2 * Math.cos(3 * i) - Math.cos(4 * i)) * 0.9;
          createParticle(vx, vy, '#ff1493', { endColor: '#ffb6c1', linger: true, lingerDelay: 25, friction: 0.96, gravity: 0, flicker: true, size: 2.5, decay: 0.015, trailLength: 3, lingerTimer: 150 });
        }
        break;

      case '貓咪 (Cat)':
        audio.playExplosionSound('shakudama');
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = Math.random() * 4 + 2;
          createParticle(Math.cos(a)*s, Math.sin(a)*s, '#ffffff', { decay: 0.04 });
        }
        const cScale = 7; 
        const catPoints = [];
        for(let i=0; i<Math.PI*2; i+=0.1) catPoints.push({x: Math.cos(i)*cScale, y: Math.sin(i)*cScale});
        for(let t=0; t<=1; t+=0.1){
           catPoints.push({x: (-0.7 - 0.1*t)*cScale, y: (-0.7 - 0.8*t)*cScale});
           catPoints.push({x: (-0.3 - 0.5*t)*cScale, y: (-0.9 - 0.6*t)*cScale});
           catPoints.push({x: (0.3 + 0.5*t)*cScale, y: (-0.9 - 0.6*t)*cScale}); 
           catPoints.push({x: (0.7 + 0.1*t)*cScale, y: (-0.7 - 0.8*t)*cScale}); 
        }
        for(let t=0; t<=1; t+=0.15){
           catPoints.push({x: (-0.8 - 0.6*t)*cScale, y: (-0.1 - 0.2*t)*cScale}); 
           catPoints.push({x: (-0.8 - 0.6*t)*cScale, y: (0.1 + 0.0*t)*cScale});   
           catPoints.push({x: (-0.8 - 0.6*t)*cScale, y: (0.3 + 0.2*t)*cScale});   
           catPoints.push({x: (0.8 + 0.6*t)*cScale, y: (-0.1 - 0.2*t)*cScale});   
           catPoints.push({x: (0.8 + 0.6*t)*cScale, y: (0.1 + 0.0*t)*cScale});    
           catPoints.push({x: (0.8 + 0.6*t)*cScale, y: (0.3 + 0.2*t)*cScale});    
        }
        for(let a=0; a<Math.PI*2; a+=0.5) {
           catPoints.push({x: -0.3*cScale + Math.cos(a)*0.2, y: -0.2*cScale + Math.sin(a)*0.2});
           catPoints.push({x: 0.3*cScale + Math.cos(a)*0.2, y: -0.2*cScale + Math.sin(a)*0.2});
        }
        catPoints.forEach(pt => createParticle(pt.x, pt.y, '#ffaa00', { endColor: '#ffffff', linger: true, lingerDelay: 25, friction: 0.96, gravity: 0, flicker: false, size: 2, decay: 0.015, trailLength: 3, lingerTimer: 180 }));
        break;

      case '星星 (Star)':
        audio.playExplosionSound('shakudama');
        for (let i = 0; i < 40; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = Math.random() * 4 + 2;
          createParticle(Math.cos(a)*s, Math.sin(a)*s, '#ffffff', { decay: 0.04 });
        }
        const sScale = 9; 
        for (let i = 0; i < 5; i++) {
          const angle = (i * 4 * Math.PI) / 5 - Math.PI / 2;
          const nextAngle = ((i + 1) * 4 * Math.PI) / 5 - Math.PI / 2;
          for (let j = 0; j < 1; j += 0.05) {
            const vx = (Math.cos(angle) * (1 - j) + Math.cos(nextAngle) * j) * sScale;
            const vy = (Math.sin(angle) * (1 - j) + Math.sin(nextAngle) * j) * sScale;
            createParticle(vx, vy, '#00ffff', { endColor: '#ffffff', linger: true, lingerDelay: 25, friction: 0.96, gravity: 0, flicker: true, size: 2.5, decay: 0.02, trailLength: 3, lingerTimer: 150 });
          }
        }
        break;

      case '十字架 (Cross)':
        audio.playExplosionSound('shakudama');
        for (let i = -18; i <= 18; i++) {
          createParticle(i * 1.2, 0, '#ffffff', { linger: true, lingerDelay: 15, gravity: 0, size: 2, flicker: true, decay: 0.01 });
        }
        for (let i = -10; i <= 28; i++) {
          createParticle(0, i * 1.2, '#ffffff', { linger: true, lingerDelay: 15, gravity: 0, size: 2, flicker: true, decay: 0.01 });
        }
        break;

      case '新星 (Nova)':
        audio.playExplosionSound('shakudama');
        screenShake(15);
        for(let i=0; i<150; i++){
          const a = Math.random() * Math.PI * 2;
          const s = Math.random() * 3 + 1;
          const iceColor = Math.random() > 0.5 ? '#ffffff' : '#00ffff';
          createParticle(Math.cos(a)*s, Math.sin(a)*s, iceColor, { decay: 0.02, size: 2 });
        }
        const numCones = 10;
        for(let c=0; c<numCones; c++){
          const baseAngle = (c / numCones) * Math.PI * 2;
          for(let i=0; i<20; i++){
            const a = baseAngle + (Math.random() - 0.5) * 0.3;
            const s = Math.random() * 8 + 12;
            createParticle(Math.cos(a)*s, Math.sin(a)*s, this.color, { friction: 0.92, trailLength: 15, decay: 0.015 });
          }
        }
        break;

      case '風車 (Pinwheel)':
        audio.playExplosionSound('crackle');
        const arms = 6;
        for (let a = 0; a < arms; a++) {
          const baseAngle = (a / arms) * Math.PI * 2;
          for (let j = 1; j <= 25; j++) {
            const spd = j * 0.4;
            const ang = baseAngle + j * 0.1; 
            createParticle(Math.cos(ang)*spd, Math.sin(ang)*spd, this.color, { friction: 0.95, trailLength: 8, decay: 0.012, flicker: true, gravity: 0 });
          }
        }
        break;

      case '彗星 (Comet)':
        audio.playExplosionSound('shakudama');
        const cometAngle = -Math.PI / 4 + (Math.random() - 0.5); 
        const cometSpeed = 12 + Math.random() * 4;
        createParticle(Math.cos(cometAngle)*cometSpeed, Math.sin(cometAngle)*cometSpeed, '#ffffff', { endColor: '#aaccff', friction: 0.99, gravity: 0.05, size: 5, decay: 0.005, trailLength: 40, flicker: true });
        for(let i=0; i<15; i++) {
           const offsetAngle = cometAngle + (Math.random() - 0.5) * 0.2;
           const offsetSpeed = cometSpeed * (0.8 + Math.random() * 0.2);
           createParticle(Math.cos(offsetAngle)*offsetSpeed, Math.sin(offsetAngle)*offsetSpeed, '#aaccff', { endColor: '#ffffff', friction: 0.98, gravity: 0.05, size: 2, decay: 0.01, trailLength: 30 });
        }
        for (let i = 0; i < 30; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = Math.random() * 4;
          createParticle(Math.cos(a) * s, Math.sin(a) * s, '#ffffff', { decay: 0.03, trailLength: 5 });
        }
        break;

      case '流金瀑布_Shell': 
        audio.playExplosionSound('crackle');
        for(let i=0; i<150; i++){
           const vx = (Math.random() - 0.5) * 4; 
           const vy = Math.random() * 4 + 1; 
           createParticle(vx, vy, '#ffd700', { endColor: '#ffffff', gravity: 0.2, friction: 0.96, decay: 0.003, trailLength: 20, flicker: true });
        }
        break;
      
      default:
        audio.playExplosionSound('normal');
        for (let i = 0; i < 100; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 6 + 2;
          createParticle(Math.cos(angle) * speed, Math.sin(angle) * speed, this.color, { endColor: this.endColor, friction: 0.9, decay: 0.02, trailLength: 2 });
        }
        break;
    }
  }
}

// ==========================================
// 主應用程式元件
// ==========================================
export default function App() {
  const canvasRef = useRef(null);
  
  const silhouetteGroupRef = useRef(null);
  const groundRef = useRef(null);
  const lightSmoother = useRef(0);

  const [gameStarted, setGameStarted] = useState(false);
  const [selectedType, setSelectedType] = useState('流金瀑布 (Waterfall)');
  const [autoMode, setAutoMode] = useState(false);
  
  const [bgmVolume, setBgmVolume] = useState(0.4);
  const [sfxVolume, setSfxVolume] = useState(0.7);
  
  const [uiVisible, setUiVisible] = useState(window.innerWidth > 768); 

  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [activePoem, setActivePoem] = useState(null);

  const [customFireworks, setCustomFireworks] = useState([]);

  const FIREWORK_TYPES = [
    { cat: '傳統花火', list: ['牡丹 (Peony)', '菊花 (Chrysanthemum)', '柳樹 (Willow)', '尺玉 (Shakudama)'] },
    { cat: '造型花火 (殘影)', list: ['愛心 (Heart)', '貓咪 (Cat)', '星星 (Star)', '十字架 (Cross)'] },
    { cat: '特殊花火', list: ['流金瀑布 (Waterfall)', '彗星 (Comet)', '新星 (Nova)', '風車 (Pinwheel)', '棕櫚樹 (Palm)'] }
  ];

  const particlesRef = useRef([]);
  const fireworksRef = useRef([]);
  const shakeRef = useRef(0);
  const autoTimerRef = useRef(null);
  const poemTimerRef = useRef(null);

  const addParticle = useCallback((p) => particlesRef.current.push(p), []);
  const triggerShake = useCallback((amount) => shakeRef.current = amount, []);

  useEffect(() => {
    audio.setBgmVolume(bgmVolume);
  }, [bgmVolume]);

  useEffect(() => {
    audio.setSfxVolume(sfxVolume);
  }, [sfxVolume]);

  const launchFirework = useCallback((x, y, type, aiConfig = null, isClusterChild = false) => {
    if (!gameStarted) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const startX = x || (canvas.width * 0.2 + Math.random() * canvas.width * 0.6);
    const targetY = y || (canvas.height * 0.1 + Math.random() * canvas.height * 0.3);
    
    let fType = type;
    let fAiConfig = aiConfig;
    
    if (!fType && !fAiConfig) {
      const allTraditional = FIREWORK_TYPES.flatMap(c => c.list);
      const allOptions = [...allTraditional, ...customFireworks];
      const randomPick = allOptions[Math.floor(Math.random() * allOptions.length)];
      
      if (typeof randomPick === 'string') {
        fType = randomPick;
      } else {
        fType = 'AI_CUSTOM';
        fAiConfig = randomPick.aiConfig;
      }
    }

    if (!isClusterChild) {
      if (fType === '流金瀑布 (Waterfall)') {
        audio.init();
        const count = 5 + Math.floor(Math.random() * 4); 
        for (let i = 0; i < count; i++) {
          const offsetX = startX - 150 + (i * (300 / count)) + (Math.random() * 30 - 15);
          const offsetY = targetY - 100 + (Math.random() * 40 - 20); 
          fireworksRef.current.push(new Firework(canvas, offsetX, canvas.height, offsetY, '流金瀑布_Shell', null));
        }
        return;
      }

      if (fAiConfig && fAiConfig.clusterLaunch) {
        audio.init();
        const count = 3 + Math.floor(Math.random() * 3); 
        for (let i = 0; i < count; i++) {
          const offsetX = startX - 100 + (i * (200 / count)) + (Math.random() * 30 - 15);
          const offsetY = targetY + (Math.random() * 60 - 30);
          fireworksRef.current.push(new Firework(canvas, offsetX, canvas.height, offsetY, fType, fAiConfig));
        }
        return;
      }
    }

    fireworksRef.current.push(new Firework(canvas, startX, canvas.height, targetY, fType, fAiConfig));
  }, [gameStarted, customFireworks]);

  const handlePointerDown = (e) => {
    if (!gameStarted) return;
    if (e.target.closest('.ui-panel')) return;
    if (e.button !== 0) return; 

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const riverY = canvasRef.current.height * 0.75;
    if (y > riverY) return;

    let fType = selectedType;
    let fAiConfig = null;
    const customMatch = customFireworks.find(f => f.id === selectedType);
    if (customMatch) {
      fType = 'AI_CUSTOM';
      fAiConfig = customMatch.aiConfig;
    }

    launchFirework(x, y, fType, fAiConfig);
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    if (!gameStarted) return;
    if (e.target.closest('.ui-panel')) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const riverY = canvasRef.current.height * 0.75;
    if (y > riverY) return;

    const customMatch = customFireworks.find(f => f.id === selectedType);
    if (customMatch) {
      launchFirework(x, y, 'AI_CUSTOM', customMatch.aiConfig);
      
      setActivePoem({ id: Date.now(), name: customMatch.name, text: customMatch.aiConfig.poem });
      if (poemTimerRef.current) clearTimeout(poemTimerRef.current);
      poemTimerRef.current = setTimeout(() => {
        setActivePoem(null);
      }, 6000);
    } else {
      launchFirework(x, y, selectedType);
    }
  };

  const handleAIGenerate = async () => {
    if (!aiPrompt.trim() || isGenerating) return;
    setIsGenerating(true);
    audio.init();

    try {
      const aiConfig = await generateAIFireworkConfig(aiPrompt);
      
      setActivePoem({ id: Date.now(), name: aiConfig.name, text: aiConfig.poem });
      if (poemTimerRef.current) clearTimeout(poemTimerRef.current);
      poemTimerRef.current = setTimeout(() => {
        setActivePoem(null);
      }, 6000); 

      const newCustomFirework = {
        id: `ai_${Date.now()}`,
        name: aiConfig.name,
        type: 'AI_CUSTOM',
        aiConfig: aiConfig
      };
      setCustomFireworks(prev => [...prev, newCustomFirework]);
      setSelectedType(newCustomFirework.id); 

      const canvas = canvasRef.current;
      if (canvas && canvas.width > 0) {
        launchFirework(canvas.width / 2, canvas.height * 0.25, 'AI_CUSTOM', aiConfig);
      }
      setAiPrompt(''); 
    } catch (err) {
      console.error("AI 花火生成失敗:", err);
      alert("抱歉，花火職人靈感枯竭了，請稍後再試！");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteCustom = (id) => {
    setCustomFireworks(prev => prev.filter(f => f.id !== id));
    if (selectedType === id) {
      setSelectedType('牡丹 (Peony)');
    }
  };

  const handleExport = () => {
    if (customFireworks.length === 0) {
      alert("目前沒有專屬花火可以匯出喔！");
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(customFireworks));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "my_custom_fireworks.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (Array.isArray(imported)) {
          const valid = imported.filter(f => f.id && f.name && f.aiConfig);
          setCustomFireworks(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const newFireworks = valid.filter(v => !existingIds.has(v.id));
            return [...prev, ...newFireworks];
          });
          alert(`成功匯入 ${valid.length} 顆專屬花火！`);
        }
      } catch (err) {
        alert("檔案格式錯誤，匯入失敗。");
      }
    };
    reader.readAsText(file);
    e.target.value = null; 
  };

  useEffect(() => {
    if (autoMode && gameStarted) {
      autoTimerRef.current = setInterval(() => {
        launchFirework(null, null, null); 
      }, 1500 + Math.random() * 2000); 
    } else {
      clearInterval(autoTimerRef.current);
    }
    return () => clearInterval(autoTimerRef.current);
  }, [autoMode, gameStarted, launchFirework]);

  const handleStart = () => {
    audio.init();
    audio.startBGM(); 
    setGameStarted(true);
    setTimeout(() => {
      if (canvasRef.current && canvasRef.current.width > 0) {
        launchFirework(canvasRef.current.width / 2, canvasRef.current.height * 0.3, '流金瀑布 (Waterfall)');
      }
    }, 500);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const fireworkCanvas = document.createElement('canvas');
    const fCtx = fireworkCanvas.getContext('2d');

    let animationFrameId;

    const resize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth || 800;
        canvasRef.current.height = window.innerHeight || 600;
        fireworkCanvas.width = canvasRef.current.width;
        fireworkCanvas.height = canvasRef.current.height;
      }
    };
    window.addEventListener('resize', resize);
    resize();

    const stars = Array.from({ length: 150 }).map(() => ({
      x: Math.random() * (window.innerWidth || 800),
      y: Math.random() * ((window.innerHeight || 600) * 0.75), 
      size: Math.random() * 1.5,
      alpha: Math.random()
    }));

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      if (width <= 0 || height <= 0) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }
      
      const riverY = height * 0.75; 

      let explosionIntensity = 0;
      for (let p of particlesRef.current) {
        explosionIntensity += p.alpha; 
      }
      lightSmoother.current += (explosionIntensity * 0.005 - lightSmoother.current) * 0.15;
      const lightVal = Math.min(1, lightSmoother.current);

      if (silhouetteGroupRef.current) {
        const r = Math.floor(15 + lightVal * 60);
        const g = Math.floor(20 + lightVal * 35);
        const b = Math.floor(30 + lightVal * 10);
        silhouetteGroupRef.current.style.fill = `rgb(${r}, ${g}, ${b})`;
      }
      if (groundRef.current) {
        const r = Math.floor(10 + lightVal * 45);
        const g = Math.floor(15 + lightVal * 25);
        const b = Math.floor(20 + lightVal * 5);
        groundRef.current.style.fill = `rgb(${r}, ${g}, ${b})`;
      }

      let dx = 0, dy = 0;
      if (shakeRef.current > 0) {
        dx = (Math.random() - 0.5) * shakeRef.current;
        dy = (Math.random() - 0.5) * shakeRef.current;
        shakeRef.current *= 0.9;
        if (shakeRef.current < 0.5) shakeRef.current = 0;
      }

      ctx.save();
      ctx.translate(dx, dy);

      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(5, 5, 15, 0.25)'; 
      ctx.fillRect(-50, -50, width + 100, height + 100);

      ctx.fillStyle = '#fff';
      stars.forEach(star => {
        star.alpha += (Math.random() - 0.5) * 0.1;
        if (star.alpha < 0) star.alpha = 0;
        if (star.alpha > 1) star.alpha = 1;
        ctx.globalAlpha = star.alpha * 0.5;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;

      fCtx.clearRect(0, 0, width, height);

      for (let i = fireworksRef.current.length - 1; i >= 0; i--) {
        const f = fireworksRef.current[i];
        f.update(addParticle, triggerShake);
        f.draw(fCtx);
        if (f.exploded) fireworksRef.current.splice(i, 1);
      }

      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.update();
        p.draw(fCtx);
        if (p.alpha <= 0) particlesRef.current.splice(i, 1);
      }

      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(fireworkCanvas, 0, 0);

      ctx.globalCompositeOperation = 'source-over';
      const gradient = ctx.createLinearGradient(0, riverY, 0, height);
      gradient.addColorStop(0, 'rgba(10, 15, 30, 0.9)');
      gradient.addColorStop(1, 'rgba(0, 0, 5, 0.95)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, riverY, width, height - riverY);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, riverY, width, height - riverY);
      ctx.clip(); 

      ctx.translate(0, riverY * 2); 
      ctx.scale(1, -1);             
      ctx.globalAlpha = 0.35;        
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(fireworkCanvas, 0, Math.sin(Date.now() * 0.002) * 2, width, height);
      ctx.drawImage(fireworkCanvas, Math.cos(Date.now() * 0.0015) * 2, 0, width, height);
      
      ctx.restore(); 

      ctx.strokeStyle = '#000';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(0, riverY);
      ctx.lineTo(width, riverY);
      ctx.stroke();

      ctx.restore(); 

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(animationFrameId);
    };
  }, [addParticle, triggerShake]);

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden font-sans select-none touch-none">
      <canvas 
        ref={canvasRef} 
        className="block w-full h-full cursor-crosshair touch-none"
        onPointerDown={handlePointerDown}
        onContextMenu={handleContextMenu}
      />

      {/* ==========================================
          開始畫面
          ========================================== */}
      {!gameStarted && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-b from-[#0a0f24] to-[#000000] text-white">
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-1/4 left-1/4 w-32 h-32 bg-orange-500 rounded-full blur-[100px] opacity-30 animate-pulse"></div>
            <div className="absolute top-1/2 right-1/4 w-48 h-48 bg-blue-500 rounded-full blur-[120px] opacity-20"></div>
          </div>
          
          <div className="z-10 text-center space-y-6 max-w-md px-6 bg-black/40 p-10 rounded-2xl border border-white/10 backdrop-blur-sm shadow-2xl">
            <h2 className="text-xl text-orange-300 tracking-[0.3em] font-light">夜空に咲く花</h2>
            <h1 className="text-4xl md:text-6xl font-extrabold tracking-wider text-transparent bg-clip-text bg-gradient-to-br from-yellow-300 via-orange-400 to-red-500 pb-2">
              盛夏花火祭
            </h1>
            
            <div className="py-6 text-sm md:text-base text-gray-300 leading-relaxed border-t border-b border-white/10 my-6">
              <p>在這靜謐的夏夜，微風輕拂，</p>
              <p>遠處傳來祭典熱鬧的太鼓聲...</p>
              <br/>
              <p className="text-white font-semibold">【 操作說明 】</p>
              <p>✨ 左鍵點擊：施放煙火</p>
              <p>✨ 右鍵點擊：施放自訂煙火並<span className="text-yellow-300">再次吟唱俳句</span></p>
            </div>

            <button 
              onClick={handleStart}
              className="group relative px-8 py-3 bg-gradient-to-r from-orange-500 to-red-600 rounded-full font-bold text-lg hover:scale-105 transition-all duration-300 shadow-[0_0_20px_rgba(255,100,0,0.4)]"
            >
              進入祭典 (開啟音樂)
              <span className="absolute inset-0 rounded-full border-2 border-white/20 group-hover:animate-ping"></span>
            </button>
          </div>
        </div>
      )}

      {/* ==========================================
          AI 俳句浮水印顯示區
          ========================================== */}
      {activePoem && (
        <div key={activePoem.id} className="absolute top-[15%] left-1/2 -translate-x-1/2 z-10 pointer-events-none flex flex-col items-center justify-center animate-fade-in-out drop-shadow-2xl">
          <div className="text-yellow-300 text-sm md:text-lg mb-6 tracking-widest font-serif opacity-90 drop-shadow-[0_0_5px_rgba(0,0,0,0.8)]">
            『 {String(activePoem.name)} 』
          </div>
          <div className="text-white text-2xl md:text-4xl font-serif tracking-[0.4em] leading-loose [writing-mode:vertical-rl] shadow-black drop-shadow-[0_0_12px_rgba(0,0,0,1)] whitespace-pre-line py-4 px-2">
            {String(activePoem.text).replace(/[,，。]/g, '\n')}
          </div>
        </div>
      )}

      {/* ==========================================
          使用者操作介面 UI
          ========================================== */}
      <div className={`ui-panel absolute top-4 right-4 z-20 transition-all duration-300 ease-in-out ${uiVisible ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-10 pointer-events-none'}`}>
        <div className="bg-black/70 backdrop-blur-md text-white p-4 md:p-5 rounded-xl border border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.1)] w-72 md:w-80 max-h-[85vh] overflow-y-auto custom-scrollbar flex flex-col gap-4">
          
          <div className="flex justify-between items-center">
            <h1 className="text-lg md:text-xl font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 to-red-400">
              🎇 花火選單
            </h1>
          </div>

          <div className="flex flex-col gap-2 bg-white/5 p-3 rounded-lg border border-white/10">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs md:text-sm text-blue-200">🎵 BGM 音量</span>
              <input 
                type="range" 
                min="0" max="1" step="0.05" 
                value={bgmVolume} 
                onChange={e => setBgmVolume(parseFloat(e.target.value))} 
                className="w-24 md:w-32 accent-blue-500" 
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="font-semibold text-xs md:text-sm text-orange-200">💥 煙火音效</span>
              <input 
                type="range" 
                min="0" max="1" step="0.05" 
                value={sfxVolume} 
                onChange={e => setSfxVolume(parseFloat(e.target.value))} 
                className="w-24 md:w-32 accent-orange-500" 
              />
            </div>
            <div className="flex items-center justify-between mt-1 pt-2 border-t border-white/10">
              <span className="font-semibold text-xs md:text-sm">✨ 自動施放模式</span>
              <button 
                onClick={() => setAutoMode(!autoMode)}
                className={`relative inline-flex h-5 w-10 md:h-6 md:w-11 items-center rounded-full transition-colors ${autoMode ? 'bg-green-500' : 'bg-gray-600'}`}
              >
                <span className={`inline-block h-3 w-3 md:h-4 md:w-4 transform rounded-full bg-white transition-transform ${autoMode ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          </div>

          <div className="bg-gradient-to-br from-indigo-900/50 to-purple-900/50 p-3 rounded-xl border border-purple-400/30">
            <h2 className="text-xs font-bold text-purple-300 mb-2 flex items-center gap-1">
              ✨ AI 詠唱花火 (支援集束與造型)
            </h2>
            <p className="text-[10px] text-gray-300 mb-2 leading-tight">
              描述您的想像，AI 會打造專屬形狀與俳句。試著加入「齊發」來召喚壯觀流星雨！
            </p>
            <input 
              type="text" 
              value={aiPrompt}
              onChange={e => setAiPrompt(e.target.value)}
              placeholder="例: 夜空中閃耀的巨大棕櫚樹..."
              className="w-full bg-black/50 border border-purple-500/50 rounded p-2 text-xs text-white mb-2 focus:outline-none focus:border-purple-400"
              onKeyDown={e => e.key === 'Enter' && handleAIGenerate()}
            />
            <button 
              onClick={handleAIGenerate}
              disabled={isGenerating || !aiPrompt.trim()}
              className={`w-full py-2 rounded text-xs font-bold transition-all ${isGenerating ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 text-white shadow-[0_0_10px_rgba(168,85,247,0.4)]'}`}
            >
              {isGenerating ? '✨ 職人構築中...' : '✨ 創造專屬花火'}
            </button>
          </div>

          <div className="space-y-3 md:space-y-4">
            {FIREWORK_TYPES.map((category, idx) => (
              <div key={idx}>
                <h2 className="text-[10px] md:text-xs font-bold text-gray-400 uppercase mb-1 md:mb-2 border-b border-gray-600 pb-1">
                  {category.cat}
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {category.list.map(firework => (
                    <button
                      key={firework}
                      onClick={() => setSelectedType(firework)}
                      className={`text-left text-xs px-2 py-1.5 rounded transition-all duration-200 ${
                        selectedType === firework 
                          ? 'bg-gradient-to-r from-orange-600 to-red-600 text-white shadow-lg scale-[1.02]' 
                          : 'bg-white/5 text-gray-300 hover:bg-white/15'
                      }`}
                    >
                      {firework.split(' ')[0]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            
            {customFireworks.length > 0 && (
              <div>
                <div className="flex justify-between items-center mb-1 md:mb-2 border-b border-purple-500/50 pb-1">
                  <h2 className="text-[10px] md:text-xs font-bold text-purple-300 uppercase">
                    專屬花火 (自訂)
                  </h2>
                  <div className="flex gap-1.5">
                    <label className="cursor-pointer text-[10px] bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded transition-colors text-gray-300">
                      匯入
                      <input type="file" accept=".json" className="hidden" onChange={handleImport} />
                    </label>
                    <button onClick={handleExport} className="text-[10px] bg-white/10 hover:bg-white/20 px-1.5 py-0.5 rounded transition-colors text-gray-300">
                      匯出
                    </button>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-2">
                  {customFireworks.map(fw => (
                    <div key={fw.id} className="relative group flex">
                      <button
                        onClick={() => setSelectedType(fw.id)}
                        className={`flex-1 text-left text-xs px-2 py-1.5 rounded transition-all duration-200 truncate pr-6 ${
                          selectedType === fw.id 
                            ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg scale-[1.02]' 
                            : 'bg-white/5 text-gray-300 hover:bg-white/15'
                        }`}
                        title={fw.name}
                      >
                        {fw.name}
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCustom(fw.id);
                        }}
                        className="absolute right-1 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-400 hover:bg-red-400/20 rounded-full opacity-0 group-hover:opacity-100 transition-all text-xs"
                        title="刪除花火"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

        </div>
      </div>

      {gameStarted && (
        <button 
          onClick={() => setUiVisible(!uiVisible)}
          className={`ui-panel absolute top-4 right-4 z-30 bg-black/60 backdrop-blur text-white p-2 md:p-3 rounded-full border border-white/20 hover:bg-white/20 transition-all duration-300 shadow-lg text-sm ${uiVisible ? '-translate-x-[calc(100vw-4rem)] md:-translate-x-[340px]' : 'translate-x-0'}`}
        >
          {uiVisible ? '✕' : '🎇 選單'}
        </button>
      )}

      {/* ==========================================
          前景剪影
          ========================================== */}
      <div className="absolute bottom-0 left-0 right-0 z-10 pointer-events-none w-full flex justify-center md:justify-start overflow-hidden">
        <svg viewBox="0 0 800 200" className="w-full min-w-[800px] h-auto max-h-[30vh] md:max-h-[40vh] drop-shadow-[0_0_15px_rgba(0,0,0,0.8)]">
          <defs>
            <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          <g opacity="0.9">
            <path d="M0,200 L800,200 L800,160 Q600,140 400,145 Q200,150 0,140 Z" fill="#0d0d0d" />
            <rect x="50" y="110" width="80" height="40" fill="#1a1a1a" />
            <polygon points="40,110 140,110 120,95 60,95" fill="#2a2a2a" />
            <rect x="60" y="120" width="60" height="15" fill="#ffaa00" filter="url(#glow)" opacity="0.6" /> 
            <rect x="55" y="110" width="4" height="40" fill="#000" />
            <rect x="121" y="110" width="4" height="40" fill="#000" />
            <rect x="650" y="105" width="90" height="45" fill="#1a1a1a" />
            <polygon points="635,105 755,105 730,85 660,85" fill="#2a2a2a" />
            <rect x="665" y="115" width="60" height="20" fill="#ff7700" filter="url(#glow)" opacity="0.7" /> 
            <path d="M0,80 Q200,110 400,90 Q600,70 800,95" fill="none" stroke="#222" strokeWidth="2" />
            {[50, 150, 250, 350, 450, 550, 650, 750].map((x, i) => {
              const y = 80 + Math.sin(x/800 * Math.PI) * 20; 
              return (
                <g key={i}>
                  <path d={`M${x-5},${y} Q${x-8},${y+8} ${x-5},${y+16} L${x+5},${y+16} Q${x+8},${y+8} ${x+5},${y} Z`} fill="#e62b2b" filter="url(#glow)" opacity="0.95" />
                  <rect x={x-3.5} y={y-3} width="7" height="3" fill="#111" />
                  <rect x={x-3.5} y={y+16} width="7" height="3" fill="#111" />
                  <text x={x-4} y={y+11} fontSize="8" fill="#fff" fontWeight="bold" fontFamily="sans-serif">祭</text>
                </g>
              );
            })}
          </g>

          <path ref={groundRef} d="M0,200 L800,200 L800,170 Q500,150 250,160 Q100,165 0,155 Z" fill="rgb(10,15,20)" style={{ transition: 'fill 0.1s ease-out' }} />
          
          <g ref={silhouetteGroupRef} fill="rgb(15,20,30)" transform="translate(100, 35)" style={{ transition: 'fill 0.1s ease-out' }}>
            <path d="M40,125 Q50,115 60,125 Q70,122 75,130 Q85,125 80,135 L40,135 Z" />
            <path d="M70,118 Q75,110 85,115 Q90,122 80,125 Z" /> 
            <path d="M82,112 L86,105 L88,113 Z M78,113 L74,106 L80,111 Z" /> 
            <rect x="110" y="90" width="40" height="45" rx="2" /> 
            <path d="M105,115 L155,115 L155,120 L105,120 Z" /> 
            <rect x="115" y="120" width="5" height="15" /> 
            <rect x="140" y="120" width="5" height="15" /> 
            <circle cx="125" cy="80" r="10" />
            <path d="M115,95 Q125,85 135,95 L135,115 L115,115 Z" />
            <circle cx="140" cy="85" r="9" />
            <circle cx="146" cy="80" r="4" /> 
            <path d="M132,98 Q140,90 148,98 L148,115 L132,115 Z" />
            <path d="M142,100 L150,110 L140,115 Z" /> 

            <path d="M180,105 L320,105 L320,110 L180,110 Z" /> 
            <rect x="190" y="110" width="6" height="25" />
            <rect x="304" y="110" width="6" height="25" />
            <rect x="185" y="80" width="130" height="25" rx="3" /> 
            <circle cx="210" cy="65" r="12" />
            <path d="M195,85 Q210,70 225,85 L225,105 L195,105 Z" />
            <path d="M190,88 L200,100 L195,105 Z" /> 
            <circle cx="250" cy="70" r="11" />
            <path d="M236,88 Q250,75 264,88 L264,105 L236,105 Z" />
            <path d="M255,90 L270,108 L250,105 Z" /> 
            <rect x="230" y="90" width="10" height="12" rx="3" transform="rotate(-15 235 95)" />
            <path d="M242,70 Q235,85 238,95 L262,95 Q265,85 260,70 Z" />
            <path d="M255,65 L268,60" stroke="#000" strokeWidth="2" /> 
            <circle cx="230" cy="80" r="8" />
            <path d="M222,92 Q230,85 238,92 L238,105 L222,105 Z" />
            <rect x="218" y="95" width="6" height="6" rx="2" /> 
            <path d="M232,95 L255,80" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            <path d="M228,95 L245,88 L235,100 Z" /> 

            <g transform="translate(400, 110)">
              <circle cx="0" cy="-35" r="8" />
              <circle cx="-6" cy="-40" r="3" />
              <path d="M-8,-20 Q0,-15 8,-20 L15,10 L-15,10 Z" />
              <path d="M-10,-18 L-22,-35 L-15,-38 L-5,-22 Z" />
              <path d="M10,-18 L20,-5 L25,5 L15,-2 Z" />
              <rect x="-6" y="-12" width="12" height="6" rx="2" transform="rotate(10)" />
              
              <g transform="translate(45, 10)">
                <path d="M-5,0 Q0,5 5,0 L8,-25 Q0,-30 -8,-25 Z" />
                <circle cx="0" cy="-30" r="6" />
                <path d="M-5,-34 L-9,-42 L-1,-36 Z M5,-34 L9,-42 L1,-36 Z" />
                <path d="M-7,-20 Q-15,-25 -15,-12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M7,-20 Q15,-25 15,-12" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M5,-5 Q15,-5 12,-15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
              </g>
            </g>
          </g>
        </svg>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @keyframes fade-in-out {
          0% { opacity: 0; transform: translate(-50%, 15px); }
          15% { opacity: 1; transform: translate(-50%, 0); }
          85% { opacity: 1; transform: translate(-50%, 0); }
          100% { opacity: 0; transform: translate(-50%, -15px); }
        }
        .animate-fade-in-out {
          animation: fade-in-out 6s ease-in-out forwards;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        @media (min-width: 768px) {
          .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 10px;
        }
      `}} />
    </div>
  );
}
