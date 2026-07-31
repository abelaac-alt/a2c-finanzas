(function(){
  'use strict';
  const A=window.A2C;
  async function authenticated(){const session=await A.requireAuth();if(!session)throw new Error('La sesión ha caducado. Abre A2C e inicia sesión de nuevo.');return session;}
  async function registerPayment(payment){
    try{
      const session=await authenticated();const amount=Math.round(Number(payment?.amount_cents||0));const concept=String(payment?.merchant||payment?.concept||'Pago con tarjeta').trim().slice(0,140);if(!(amount>0)||!concept)throw new Error('El pago no contiene un importe o comercio válido.');
      const timestamp=Number(payment?.payment_time||Date.now());const date=new Date(timestamp);const occurredOn=A.isoDate(date);const fingerprint=String(payment?.fingerprint||`${amount}|${concept.toLowerCase()}|${Math.floor(timestamp/60000)}`);const note=`[A2C-ANDROID:${fingerprint}]`;
      const duplicate=await A.sb.from('finance_transactions').select('id').eq('creator_id',session.user.id).eq('notes',note).limit(1);if(duplicate.error)throw duplicate.error;if(duplicate.data.length)return {ok:true,duplicate:true};
      const liters=Number(payment?.fuel_liters||0);const fuelPrice=Math.round(Number(payment?.fuel_price_per_liter_milli||0));const km=Number(payment?.fuel_km||0);const result=await A.sb.from('finance_transactions').insert({creator_id:session.user.id,resource_id:null,kind:'expense',category_id:null,merchant:concept,payment_method:String(payment?.payment_method||'bank'),amount_cents:amount,concept:String(payment?.concept||concept),occurred_on:occurredOn,notes:note,budget_category:liters>0?'fuel':A.classify(concept),fuel_liters:liters>0?liters:null,fuel_price_per_liter_milli:fuelPrice>0?fuelPrice:null,fuel_km:km>0?km:null,fuel_consumption_l100km:liters>0&&km>0?Number((liters/km*100).toFixed(2)):null}).select('id').single();if(result.error)throw result.error;A.store.clearStatistics();await A.store.load({force:true});return {ok:true,id:result.data.id};
    }catch(error){return {ok:false,error:error.message||'No se pudo registrar el pago.'};}
  }
  window.a2cAndroidRegisterPayment=registerPayment;
  window.a2cAndroidRegisterFuel=payment=>registerPayment({...payment,merchant:payment?.merchant||payment?.concept||'Combustible',concept:payment?.concept||'Combustible'});
  window.a2cAndroidGetNativeData=async()=>{try{await authenticated();return await A.rpc('a2c_widget_snapshot_v8');}catch(error){return {error:'not_authenticated',message:error.message};}};
  window.a2cAndroidOpenDestination=destination=>{const map={home:'home',activity:'activity',messages:'messages',profile:'profile',tools:'tools',statistics:'tools','pending-payments':'activity'};if(destination==='statistics')A.state.tool='statistics';A.navigate(map[destination]||'home');};
})();
