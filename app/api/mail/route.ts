import {cookies} from 'next/headers';
export const dynamic='force-dynamic';
const base='https://lajzrempjyoqkubkumhb.supabase.co/functions/v1';
export async function POST(request:Request){
 const origin=request.headers.get('origin');if(origin&&origin!==new URL(request.url).origin)return Response.json({error:'Invalid origin'},{status:403});
 if(Number(request.headers.get('content-length'))>16*1024*1024)return Response.json({error:'Request too large'},{status:413});
 try{const text=await request.text();if(text.length>16*1024*1024)return Response.json({error:'Request too large'},{status:413});const body=JSON.parse(text);const jar=await cookies();const token=jar.get('mail7mit_session')?.value;
 if(body.action==='login'){const r=await fetch(base+'/akun-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'login',username:body.username,password:body.password,account_key:body.account_key}),signal:AbortSignal.timeout(20000)});const data:any=await r.json();if(!r.ok)return Response.json(data,{status:r.status});if(!data.token)return Response.json({error:'Login failed'},{status:401});const response=Response.json({profile:data.profile});response.headers.set('Set-Cookie',`mail7mit_session=${encodeURIComponent(data.token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=34560000`);return response}
 if(body.action==='logout'){if(token)await fetch(base+'/akun-auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'logout',token})});const r=Response.json({ok:true});r.headers.set('Set-Cookie','mail7mit_session=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');return r}
 const r=await fetch(base+'/mail7mit-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,token}),signal:AbortSignal.timeout(55000)});const data:any=await r.json();const out=Response.json(data,{status:r.status,headers:{'Cache-Control':'no-store'}});if(token&&r.ok)out.headers.set('Set-Cookie',`mail7mit_session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=34560000`);return out
 }catch{return Response.json({error:'Mail service is unavailable. Your input has been preserved. Try again.'},{status:502})}
}
