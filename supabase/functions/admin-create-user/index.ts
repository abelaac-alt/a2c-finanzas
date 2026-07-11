import { createClient } from 'npm:@supabase/supabase-js@2'

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS'
}
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors})
  if(req.method!=='POST')return response({error:'Método no permitido'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL')!
    const anon=Deno.env.get('SUPABASE_ANON_KEY')!
    const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const authorization=req.headers.get('Authorization')||''
    if(!authorization.startsWith('Bearer '))return response({error:'Sesión no válida'},401)

    const caller=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false}})
    const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}})
    const token=authorization.slice(7)
    const {data:{user},error:userError}=await caller.auth.getUser(token)
    if(userError||!user)return response({error:'Sesión no válida'},401)

    const {data:profile,error:profileError}=await admin.from('profiles').select('role,active').eq('id',user.id).single()
    if(profileError||profile?.role!=='admin'||!profile.active)return response({error:'Solo un administrador puede crear usuarios'},403)

    const body=await req.json()
    const email=String(body.email||'').trim().toLowerCase()
    const password=String(body.password||'')
    const displayName=String(body.display_name||'').trim()
    if(!/^\S+@\S+\.\S+$/.test(email))return response({error:'Email no válido'},400)
    if(password.length<8)return response({error:'La contraseña debe tener al menos 8 caracteres'},400)
    if(!displayName)return response({error:'El nombre es obligatorio'},400)

    const {data,error}=await admin.auth.admin.createUser({
      email,password,email_confirm:true,
      user_metadata:{display_name:displayName,created_by:user.id}
    })
    if(error)return response({error:error.message},400)
    await admin.from('profiles').update({display_name:displayName,active:true}).eq('id',data.user.id)
    return response({user:{id:data.user.id,email:data.user.email}})
  }catch(error){
    console.error(error)
    return response({error:'No se pudo crear el usuario'},500)
  }
})
