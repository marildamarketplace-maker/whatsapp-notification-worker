import { describe,it,expect,vi } from 'vitest';
import { NotificationService } from '../src/services/notification.service.js';
import { DeliveryError } from '../src/types/notification.js';
import { config,log,item,mocks } from './helpers.js';
function setup() {
  const {repo,gateway}=mocks(); const wait=vi.fn().mockResolvedValue(undefined); const stop=new AbortController();
  const service=new NotificationService(repo,gateway,config,log,()=>{},wait);
  return {repo,gateway,wait,stop,service};
}
describe('notification processing',()=>{
  it('sends once and marks accepted SUCESSO',async()=> {
    const {repo,gateway,service,stop}=setup(); await service.process(item,stop.signal);
    expect(gateway.send).toHaveBeenCalledExactlyOnceWith('120363412284116447@g.us','✅ Mensagens Shopee\n\nConcluída.\n11/11, 17:27');
    expect(repo.finish).toHaveBeenCalledWith(item,'SUCESSO',null,120);
    expect(item.to).toBe('120363412284116447-group');
  });
  it('validates before requesting HTTP',async()=>{
    const {repo,gateway,service,stop}=setup();await service.process({...item,to:'bad'},stop.signal);
    expect(gateway.connected).not.toHaveBeenCalled();expect(gateway.send).not.toHaveBeenCalled();
    expect(repo.finish).toHaveBeenCalledWith(expect.anything(),'ERRO','INVALID_RECIPIENT',120);
  });
  it('backs off while keeping reservation and only then releases',async()=>{
    const {repo,gateway,wait,service,stop}=setup();gateway.connected.mockResolvedValue(false);
    wait.mockImplementation(async()=>{expect(repo.finish).not.toHaveBeenCalled();});
    await service.process(item,stop.signal);
    expect(wait.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(30000);
    expect(repo.finish).toHaveBeenCalledWith(item,'PENDENTE','INSTANCE_DISCONNECTED',120);
    expect(gateway.send).not.toHaveBeenCalled();
  });
  it('stops at maximum attempts',async()=>{
    const {repo,gateway,service,stop}=setup();gateway.connected.mockResolvedValue(false);
    await service.process({...item,tentativas:3},stop.signal);
    expect(repo.finish).toHaveBeenCalledWith(expect.anything(),'ERRO','INSTANCE_DISCONNECTED',120);
  });
  it.each(['TRANSPORT_UNCERTAIN','HTTP_UNCERTAIN_500','SEND_RESPONSE_INVALID'])('quarantines %s without unlocking',async code=>{
    const {repo,gateway,service,stop}=setup();gateway.send.mockRejectedValue(new DeliveryError('uncertain',code));
    await service.process(item,stop.signal);
    expect(repo.quarantine).toHaveBeenCalledWith(item,code);expect(repo.finish).not.toHaveBeenCalled();
    expect(gateway.send).toHaveBeenCalledTimes(1);
  });
  it('records explicit HTTP rejection as ERRO',async()=>{
    const {repo,gateway,service,stop}=setup();gateway.send.mockRejectedValue(new DeliveryError('permanent','HTTP_REJECTED_400'));
    await service.process(item,stop.signal);expect(repo.finish).toHaveBeenCalledWith(item,'ERRO','HTTP_REJECTED_400',120);
  });
  it('does not send after losing reservation',async()=>{
    const {repo,gateway,service,stop}=setup();repo.owns.mockResolvedValue(false);
    await service.process(item,stop.signal);expect(gateway.send).not.toHaveBeenCalled();expect(repo.finish).not.toHaveBeenCalled();
  });
  it('quarantines DB failure after acceptance and never resends',async()=>{
    const {repo,gateway,service,stop}=setup();repo.finish.mockRejectedValue(new Error('db unavailable'));
    await service.process(item,stop.signal);
    expect(gateway.send).toHaveBeenCalledTimes(1);expect(repo.quarantine).toHaveBeenCalledWith(item,'ACCEPTED_DATABASE_UPDATE_FAILED');
  });
  it('retains reservation even if quarantine metadata cannot be saved',async()=>{
    const {repo,gateway,service,stop}=setup();repo.finish.mockRejectedValue(new Error());repo.quarantine.mockRejectedValue(new Error());
    await expect(service.process(item,stop.signal)).resolves.toBeUndefined();expect(gateway.send).toHaveBeenCalledTimes(1);
  });
  it('quarantines expired ownership after acceptance',async()=>{
    const {repo,service,stop}=setup();repo.finish.mockResolvedValue(false);
    await service.process(item,stop.signal);expect(repo.quarantine).toHaveBeenCalledWith(item,'ACCEPTED_BUT_OWNERSHIP_EXPIRED');
  });
  it('shutdown during backoff retains durable claim',async()=>{
    const {repo,gateway,wait,service,stop}=setup();gateway.connected.mockResolvedValue(false);wait.mockImplementation(async()=>stop.abort());
    await service.process(item,stop.signal);expect(repo.finish).not.toHaveBeenCalled();expect(gateway.send).not.toHaveBeenCalled();
  });
  it('shutdown during in-flight send waits and persists acceptance',async()=>{
    const {repo,gateway,service,stop}=setup();gateway.send.mockImplementation(async()=>{stop.abort();return {messageId:'accepted'};});
    await service.process(item,stop.signal);expect(repo.finish).toHaveBeenCalledWith(item,'SUCESSO',null,120);
  });
  it('shutdown before send retains claim',async()=>{
    const {repo,gateway,service,stop}=setup();stop.abort();await service.process(item,stop.signal);
    expect(gateway.send).not.toHaveBeenCalled();expect(repo.finish).not.toHaveBeenCalled();
  });
  it('enforces minimum send spacing locally',async()=>{
    const {service,wait,stop}=setup();await service.process(item,stop.signal);await service.process({...item,id:'second'},stop.signal);
    expect(wait.mock.calls[1]?.[0]).toBeGreaterThan(1400);
  });
});
