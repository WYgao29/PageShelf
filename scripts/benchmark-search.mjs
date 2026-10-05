import { searchItems } from '../src/search.js';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
const items = Array.from({ length: 500 }, (_, index) => ({ id: String(index), title: '研究问题' + index, rootId: 'r', rootOrder: 0, relativePath: '研究/' + index, updatedAt: '2026-10-01', tags: ['证据'], html: { size: 1 }, searchText: '研究问题和证据收集，设计方法。'.repeat(100) }));
const samples = [];
for (let iteration = 0; iteration < 23; iteration++) { const start = performance.now(); searchItems({ items }, { q: '证据', limit: 100 }); if (iteration >= 3) samples.push(performance.now() - start); }
samples.sort((a, b) => a - b);
console.log(JSON.stringify({ items: 500, bodyCharacters: [...items[0].searchText].length, iterations: 20, medianMs: samples[10], p95Ms: samples[18], node: process.version, cpu: os.cpus()[0].model }, null, 2));
