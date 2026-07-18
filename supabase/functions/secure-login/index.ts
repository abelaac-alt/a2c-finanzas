import { createClient } from "npm:@supabase/supabase-js@2";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsHeaders,"Content-Type":"application/json","Cache-Control":"no-store"}});
const normalizeIdentifier=(v:unknown)=>String(v??"").trim().toLowerCase();
const validPassword=(v:string)=>v.length>=6&&v.length<=256&&!/[\u0000-\u001F\u007F]/.test(v);
const validUsername=(v:string)=>/^[a-z0-9._]{3,30}$/.test(v);
const validEmail=(v:string)=>v.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
async function sha256(value:string){const d=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));return Array.from(new Uint8Array(d),b=>b.toString(16).padStart(2,"0")).join("");}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsHeaders});
 if(req.method!=="POST")return json({ok:false},405);
 try{
  const body=await req.json().catch(()=>({}));const identifier=normalizeIdentifier(body.identifier??body.email);const password=typeof body.password==="string"?body.password:"";
  if(!validPassword(password))return json({ok:false,code:"invalid_credentials"});
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!anon||!service)throw new Error("Missing environment variables");
  const admin=createClient(url,service,{auth:{persistSession:false}});
  let email=identifier;
  if(identifier.startsWith("@")||(!identifier.includes("@")&&validUsername(identifier))){const username=identifier.replace(/^@/,"");if(!validUsername(username))return json({ok:false,code:"invalid_credentials"});const {data}=await admin.from("profiles").select("email").eq("username",username).maybeSingle();email=String(data?.email||"").toLowerCase();}
  if(!validEmail(email))return json({ok:false,code:"invalid_credentials"});
  const keyHash=await sha256(identifier);const now=Date.now();const {data:guard,error:gerr}=await admin.from("login_attempts").select("failed_attempts,locked_until").eq("email_hash",keyHash).maybeSingle();if(gerr)throw gerr;
  const until=guard?.locked_until?new Date(guard.locked_until).getTime():0;if(until>now)return json({ok:false,code:"locked",retry_after:Math.ceil((until-now)/1000)});if(guard&&until&&until<=now)await admin.from("login_attempts").delete().eq("email_hash",keyHash);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await auth.auth.signInWithPassword({email,password});
  if(error||!data.session||!data.user){const attempts=(guard&&!until?Number(guard.failed_attempts||0):0)+1;const lock=attempts>=5?new Date(now+15*60*1000).toISOString():null;await admin.from("login_attempts").upsert({email_hash:keyHash,failed_attempts:attempts,locked_until:lock,last_failed_at:new Date().toISOString(),updated_at:new Date().toISOString()},{onConflict:"email_hash"});return json({ok:false,code:lock?"locked":"invalid_credentials"});}
  const {data:profile}=await admin.from("profiles").select("active").eq("id",data.user.id).maybeSingle();if(profile?.active===false)return json({ok:false,code:"invalid_credentials"});
  await admin.from("login_attempts").delete().eq("email_hash",keyHash);return json({ok:true,session:{access_token:data.session.access_token,refresh_token:data.session.refresh_token}});
 }catch(e){console.error("secure-login failed",e instanceof Error?e.message:"unknown");return json({ok:false,code:"server_error"},500);}
});
