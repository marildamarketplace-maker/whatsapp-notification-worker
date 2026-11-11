import { createServer } from 'node:http';
let sends=0;
createServer((req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET'){res.end(JSON.stringify({instance:{state:'open'}}));return;}
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
    if(++sends>1){res.statusCode=500;res.end('{}');return;}
    const {number,text}=JSON.parse(body);
    if(number!=='120363412284116447@g.us'||text!=='✅ Teste\n\nMensagem de teste.'){res.statusCode=400;res.end('{}');return;}
    console.log('MOCK_ACCEPTED');res.statusCode=201;
    res.end(JSON.stringify({key:{id:'smoke-1',remoteJid:number,fromMe:true},status:'PENDING'}));
  });
}).listen(8080,'0.0.0.0');
