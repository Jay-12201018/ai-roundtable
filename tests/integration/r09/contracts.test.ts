import { expect, it } from 'vitest';
import { ipcContracts, parseIpcOutput } from '../../../src/shared/contracts/ipc';
import { publicError } from '../../../src/shared/schemas/error';
it('strictly validates the sole target-confirmation DTO and binds its response to the Provider',()=>{
 const schema=ipcContracts['settings.confirmTarget'].input;
 const input={providerId:'p',baseUrl:'http://127.0.0.1:12345/v1',confirmed:true} as const;
 expect(schema.safeParse(input).success).toBe(true);
 for(const bad of [{...input,confirmed:false},{...input,apiKey:'fake'},{...input,baseUrl:'http://10.0.0.1/v1'},{...input,baseUrl:'https://user:password@example.com/v1'}])expect(schema.safeParse(bad).success).toBe(false);
 expect(parseIpcOutput('settings.confirmTarget',input,{providerId:'p'})).toEqual({providerId:'p'});
 expect(()=>parseIpcOutput('settings.confirmTarget',input,{providerId:'other'})).toThrowError(expect.objectContaining({code:'invalid_response'}));
});
it('permits only explicit true generation authorization and keeps permission errors generic',()=>{
 const schema=ipcContracts['settings.testConnection'].input;
 expect(schema.safeParse({providerId:'p',level:'generation',modelId:'model',allowGeneration:true}).success).toBe(true);
 expect(schema.safeParse({providerId:'p',level:'generation',modelId:'model',allowGeneration:false}).success).toBe(false);
 expect(schema.safeParse({providerId:'p',level:'generation',allowGeneration:true}).success).toBe(false);
 expect(publicError('forbidden')).toEqual({code:'forbidden',message:'Permission denied',retryable:false});
});
