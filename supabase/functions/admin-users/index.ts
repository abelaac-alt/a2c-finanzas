
import { createClient } from "npm:@supabase/supabase-js@2";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
Deno.serve(async req=>{
  if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
  try{
    const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const auth=req.headers.get("Authorization")||"";
    const client=createClient(url,anon,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
    const {data:{user}}=await client.auth.getUser();
    if(!user)return json({error:"Sesión no válida"},401);
    const {data:caller}=await client.from("profiles").select("role,active").eq("id",user.id).single();
    if(caller?.role!=="admin"||caller?.active===false)return json({error:"Solo administradores"},403);

    const body=await req.json();
    const admin=createClient(url,service,{auth:{persistSession:false}});
    if(body.action==="create"){
      const {data,error}=await admin.auth.admin.createUser({email:body.email,password:body.password,email_confirm:true,user_metadata:{display_name:body.display_name}});
      if(error)return json({error:error.message},400);
      const {error:pe}=await admin.from("profiles").update({display_name:body.display_name,role:body.role,active:body.active,permissions:body.permissions}).eq("id",data.user.id);
      if(pe)return json({error:pe.message},400);
      return json({ok:true,user_id:data.user.id});
    }
    if(body.action==="update"){
      if(body.password){
        const {error}=await admin.auth.admin.updateUserById(body.user_id,{password:body.password});
        if(error)return json({error:error.message},400);
      }
      const {error}=await admin.from("profiles").update({display_name:body.display_name,role:body.role,active:body.active,permissions:body.permissions}).eq("id",body.user_id);
      if(error)return json({error:error.message},400);
      return json({ok:true});
    }
    return json({error:"Acción no válida"},400);
  }catch(error){console.error(error);return json({error:"Error interno"},500)}
});
