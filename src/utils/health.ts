import { writeFileSync, renameSync, readFileSync } from 'node:fs';
export const healthPath = '/tmp/whatsapp-worker-health.json';
export function reportProgress(budgetMs: number, healthy = true): void {
  const state = {pid:process.pid, deadline:Date.now()+budgetMs+10000, healthy};
  writeFileSync(`${healthPath}.tmp`, JSON.stringify(state), {mode:0o600});
  renameSync(`${healthPath}.tmp`,healthPath);
}
export function checkHealth(): boolean {
  try {
    const state = JSON.parse(readFileSync(healthPath,'utf8')) as {pid:number;deadline:number;healthy:boolean};
    process.kill(state.pid,0);
    return state.healthy && Number.isFinite(state.deadline) && state.deadline > Date.now();
  } catch {return false;}
}
