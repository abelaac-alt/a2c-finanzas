import { createClient } from "npm:@supabase/supabase-js@2";

const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
const normalizeEmail=(value:unknown)=>String(value??"").trim().toLowerCase();
const validEmail=(email:string)=>email.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const cleanName=(value:unknown)=>String(value??"").replace(/[\u0000-\u001F\u007F]/g," ").replace(/\s+/g," ").trim();
const validPassword=(value:string)=>value.length>=10&&value.length<=128&&/[a-z]/.test(value)&&/[A-Z]/.test(value)&&/\d/.test(value);
const validUuid=(value:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value??""));

Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  if(req.method!=="POST")return json({error:"Método no permitido"},405);
  try{
    const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth=req.headers.get("Authorization")||"";
    const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
    const {data:{user}}=await client.auth.getUser();
    if(!user)return json({error:"Sesión no válida"},401);
    const {data:caller}=await client.from("profiles").select("role,active").eq("id",user.id).single();
    if(caller?.role!=="admin"||caller?.active===false)return json({error:"Solo administradores"},403);

    const body=await req.json().catch(()=>({}));
    const action=body.action;
    const email=normalizeEmail(body.email);
    const displayName=cleanName(body.display_name);
    const password=typeof body.password==="string"?body.password:"";
    const role=body.role==="admin"?"admin":"user";
    const active=body.active===true;
    const permissions={
      can_create_shared:body.permissions?.can_create_shared===true,
      can_invite:body.permissions?.can_invite===true,
      can_upload_receipts:body.permissions?.can_upload_receipts===true,
    };

    if(!["create","update"].includes(action))return json({error:"Acción no válida"},400);
    if(!validEmail(email))return json({error:"Email no válido"},400);
    if(displayName.length<2||displayName.length>80)return json({error:"El nombre debe tener entre 2 y 80 caracteres"},400);
    if(action==="create"&&!validPassword(password))return json({error:"La contraseña debe tener entre 10 y 128 caracteres e incluir mayúscula, minúscula y número"},400);
    if(action==="update"&&password&&!validPassword(password))return json({error:"La contraseña debe tener entre 10 y 128 caracteres e incluir mayúscula, minúscula y número"},400);
    if(action==="update"&&!validUuid(body.user_id))return json({error:"Usuario no válido"},400);

    const admin=createClient(url,service,{auth:{persistSession:false}});
    if(action==="create"){
      const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{display_name:displayName}});
      if(error)return json({error:"No se pudo crear el usuario"},400);
      const {error:pe}=await admin.from("profiles").update({display_name:displayName,role,active,permissions}).eq("id",data.user.id);
      if(pe)return json({error:"No se pudo guardar el perfil"},400);
      return json({ok:true,user_id:data.user.id});
    }

    if(password){
      const {error}=await admin.auth.admin.updateUserById(body.user_id,{password});
      if(error)return json({error:"No se pudo actualizar la contraseña"},400);
    }
    const {error}=await admin.from("profiles").update({display_name:displayName,role,active,permissions}).eq("id",body.user_id);
    if(error)return json({error:"No se pudo guardar el perfil"},400);
    return json({ok:true});
  }catch(error){console.error("admin-users failed",error instanceof Error?error.message:"unknown error");return json({error:"Error interno"},500)}
});
