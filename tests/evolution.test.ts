import { createServer, type Server } from 'node:http';
import { afterEach,beforeEach,describe,it,expect } from 'vitest';
import { EvolutionClient } from '../src/clients/evolution.client.js';
import { config } from './helpers.js';
let server:Server;let url:string;let status=201;let body:unknown;let hang=false;let requestBody='';let apiKey:unknown;
beforeEach(async()=>{
 status=201;hang=false;requestBody='';body={key:{id:'abc',remoteJid:'123@g.us',fromMe:true},status:'PENDING'};
 server=createServer((req,res)=>{
  apiKey=req.headers.apikey;
  if (hang) return;
  req.on('data',chunk=>requestBody+=chunk);
  req.on('end',()=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));});
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if (!address || typeof address==='string')throw new Error();url=`http://127.0.0.1:${address.port}`;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
const client=()=>new EvolutionClient({...config,EVOLUTION_API_URL:url,REQUEST_TIMEOUT_MS:50});
describe('real HTTP against mock Evolution',()=>{
 it('validates acceptance and authenticates',async()=>{
  expect(await client().send('123@g.us','✅ ação\n\n texto')).toEqual({messageId:'abc'});
  expect(JSON.parse(requestBody)).toEqual({number:'123@g.us',text:'✅ ação\n\n texto'});expect(apiKey).toBe('test-key');
 });
 it.each([400,401,403,404,413,422])('handles rejection %s',async code=>{status=code;await expect(client().send('123@g.us','test')).rejects.toMatchObject({kind:'permanent'});});
 it.each([408,429,500,502,503])('treats ambiguous HTTP %s conservatively',async code=>{status=code;await expect(client().send('123@g.us','test')).rejects.toMatchObject({kind:'uncertain'});});
 it('quarantines timeout',async()=>{hang=true;await expect(client().send('123@g.us','test')).rejects.toMatchObject({kind:'uncertain',code:'TRANSPORT_UNCERTAIN'});});
 it.each([{}, {key:{id:'x',remoteJid:'wrong',fromMe:true},status:'PENDING'},{key:{id:'x',remoteJid:'123@g.us',fromMe:true},status:'ERROR'}])('rejects invalid 2xx response',async value=>{body=value;await expect(client().send('123@g.us','test')).rejects.toMatchObject({kind:'uncertain'});});
 it('checks nested connection contract',async()=>{body={instance:{instanceName:'test',state:'open'}};expect(await client().connected()).toBe(true);});
 it('detects disconnected instance',async()=>{body={instance:{state:'close'}};expect(await client().connected()).toBe(false);});
 it('does not accept undocumented connection shapes',async()=>{body={state:'open'};await expect(client().connected()).rejects.toMatchObject({kind:'safe-retry'});});
 it('GET timeout is safe for retry',async()=>{hang=true;await expect(client().connected()).rejects.toMatchObject({kind:'safe-retry'});});
 it('does not follow a redirect with API key',async()=>{status=302;await expect(client().send('123@g.us','test')).rejects.toMatchObject({kind:'uncertain'});});
});
