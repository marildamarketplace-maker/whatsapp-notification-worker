import { describe,it,expect } from 'vitest';
import { prepareMessage,IMAGE_PREFIX,MAX_IMAGE_BYTES } from '../src/services/message.service.js';
const png = {media:'iVBORw0KGgo=',mimetype:'image/png'};
const message = (value:unknown) => IMAGE_PREFIX + JSON.stringify(value);
describe('image payload validation',()=>{
  it('preserves plain text including ordinary JSON',()=>{
    expect(prepareMessage('Title','{"media":"text"}')).toEqual({text:'Title\n\n{"media":"text"}'});
  });
  it('allows omitted caption',()=>{
    expect(prepareMessage('Title',message(png))).toEqual({text:'Title',image:png});
  });
  it('accepts JPEG signatures',()=>{
    const image={media:Buffer.from([255,216,255,224,255,217]).toString('base64'),mimetype:'image/jpeg'};
    expect(prepareMessage('',message(image)).image).toEqual(image);
  });
  it.each([
    {}, {...png,media:'https://example.com/a.png'}, {...png,media:'file:///etc/passwd'},
    {...png,media:'data:image/png;base64,iVBORw0KGgo='}, {...png,media:'not base64'},
    {...png,media:'aGVsbG8='}, {...png,mimetype:'image/jpeg'}, {...png,mimetype:'image/svg+xml'},
    {...png,unexpected:true}, {...png,caption:'x'.repeat(1001)},
  ])('rejects unsupported or malformed image %#',value=>{
    expect(()=>prepareMessage('Title',message(value))).toThrow();
  });
  it('rejects malformed JSON and oversized captions',()=>{
    expect(()=>prepareMessage('',IMAGE_PREFIX+'{')).toThrow();
    expect(()=>prepareMessage('x'.repeat(1025),message(png))).toThrow();
  });
  it('rejects more than 5 MiB',()=>{
    const media=Buffer.alloc(MAX_IMAGE_BYTES+1).toString('base64');
    expect(()=>prepareMessage('',message({...png,media}))).toThrow();
  });
});
