import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface LPPosition {
  pairAddress: string;
  pairName: string;
  lpTokens: string;
  entryPriceRatio: number;
  entryTimestamp: number;
  entryReserve0: string;
  entryReserve1: string;
  totalFeesEarned: number;
  lastCheckedTimestamp: number;
}

export class PositionStore {
  private readonly filePath: string;

  constructor(filePath = path.resolve(process.cwd(), 'data/positions.json')) {
    this.filePath = filePath;
  }

  async getAll(): Promise<LPPosition[]> {
    await this.ensureFile();

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.filter(this.isPosition) : [];
    } catch {
      return [];
    }
  }

  async get(pairAddress: string): Promise<LPPosition | undefined> {
    const positions = await this.getAll();
    return positions.find(
      (position) => position.pairAddress.toLowerCase() === pairAddress.toLowerCase()
    );
  }

  async upsert(position: LPPosition): Promise<void> {
    const positions = await this.getAll();
    const index = positions.findIndex(
      (current) => current.pairAddress.toLowerCase() === position.pairAddress.toLowerCase()
    );

    if (index >= 0) {
      positions[index] = position;
    } else {
      positions.push(position);
    }

    await this.saveAll(positions);
  }

  async remove(pairAddress: string): Promise<void> {
    const positions = await this.getAll();
    const next = positions.filter(
      (position) => position.pairAddress.toLowerCase() !== pairAddress.toLowerCase()
    );
    await this.saveAll(next);
  }

  private async saveAll(positions: LPPosition[]): Promise<void> {
    await this.ensureFile();
    await writeFile(this.filePath, JSON.stringify(positions, null, 2) + '\n', 'utf8');
  }

  private async ensureFile(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, 'utf8');
    } catch {
      await writeFile(this.filePath, '[]\n', 'utf8');
    }
  }

  private isPosition(value: unknown): value is LPPosition {
    if (!value || typeof value !== 'object') return false;

    const candidate = value as Record<string, unknown>;
    return (
      typeof candidate.pairAddress === 'string' &&
      typeof candidate.pairName === 'string' &&
      typeof candidate.lpTokens === 'string' &&
      typeof candidate.entryPriceRatio === 'number' &&
      typeof candidate.entryTimestamp === 'number' &&
      typeof candidate.entryReserve0 === 'string' &&
      typeof candidate.entryReserve1 === 'string' &&
      typeof candidate.totalFeesEarned === 'number' &&
      typeof candidate.lastCheckedTimestamp === 'number'
    );
  }
}

