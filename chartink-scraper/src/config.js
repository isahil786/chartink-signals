import * as yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';

const yamlLoad = yaml.load;

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const CONFIG_DIR = path.join(__dirname, '..', 'config');
const STATE_DIR = path.join(__dirname, '..', 'state');

let cached = null;

function loadYaml(filename) {
  const fp = path.join(CONFIG_DIR, filename);
  if (!fs.existsSync(fp)) return {};
  const doc = yamlLoad(fs.readFileSync(fp, 'utf8'));
  return doc || {};
}

export function loadConfig() {
  if (cached) return cached;
  cached = {
    scans: loadYaml('scans.yaml'),
    settings: loadYaml('settings.yaml'),
    holidays: loadYaml('holidays.yaml'),
  };
  return cached;
}

export function getScans() {
  return Object.entries(loadConfig().scans.scans).map(([id, c]) => ({ id, ...c }));
}

export function getBreadthScans() {
  return loadConfig().scans.breadth;
}

export function getSettings() {
  return loadConfig().settings;
}

export function getHolidayList() {
  return loadConfig().holidays.holidays || [];
}

export function getRawChartinkDir() {
  return path.join(STATE_DIR, 'raw_chartink');
}
