"use client";
import { useEffect, useRef, useState } from "react";
import { gestaoRequest } from "./gestao-client";
import { CatalogError } from "./catalogo-client";
export const formas = { DINHEIRO: "Dinheiro", PIX: "Pix", CARTAO_CREDITO: "Cartão de crédito", CARTAO_DEBITO: "Cartão de débito", TRANSFERENCIA: "Transferência", BOLETO: "Boleto" };
export function diaLocal() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
export function centavos(v: string) { if (!/^\d{1,10}([.,]\d{1,2})?$/.test(v.trim())) throw new Error("Valor inválido."); const [i,d=""] = v.trim().replace(",", ".").split("."); return BigInt(i)*100n+BigInt(d.padEnd(2,"0")); }
export function textoValor(v: bigint) { const abs=v<0n?-v:v; return (v<0n?"-":"")+(abs/100n).toString()+"."+(abs%100n).toString().padStart(2,"0"); }
export function subtotalItem(quantidade: string, preco: string) { if (!/^\d{1,9}([.,]\d{1,3})?$/.test(quantidade.trim())) return 0n; const [i,d=""]=quantidade.trim().replace(",", ".").split("."); return ((BigInt(i)*1000n+BigInt(d.padEnd(3,"0")))*centavos(preco)+500n)/1000n; }
export function useComercialData<T>(path: string) {
  const [data,setData]=useState<T|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[tick,setTick]=useState(0);
  useEffect(()=>{const controller=new AbortController();setLoading(true);setError("");gestaoRequest<T>(path,{signal:controller.signal}).then(v=>{if(!controller.signal.aborted)setData(v);}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"Não foi possível carregar os dados.");}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[path,tick]);
  return {data,loading,error,reload:()=>setTick(v=>v+1)};
}
export function useComercialAction() {
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[uncertain,setUncertain]=useState(false);
  const running=useRef(false), operation=useRef<{signature:string;key:string}|null>(null);
  async function run<T>(path:string,payload:object,method="POST"):Promise<T|null>{
    if(running.current)return null;
    const signature=method+path+JSON.stringify(payload);
    if(uncertain&&operation.current?.signature!==signature){setError("Reenvie a mesma operação sem alterar os dados, ou confira o histórico antes de iniciar outra.");return null;}
    if(operation.current?.signature!==signature)operation.current={signature,key:crypto.randomUUID()};
    running.current=true;setBusy(true);setError("");
    try{const result=await gestaoRequest<T>(path,{method,body:JSON.stringify({...payload,chaveOperacao:operation.current.key})});operation.current=null;setUncertain(false);return result;}
    catch(e){const incerto=!(e instanceof CatalogError)||e.status>=500;setUncertain(incerto);setError(incerto?"Não foi possível confirmar a resposta. Reenvie sem alterar os dados; a operação não será duplicada.":e.errors?.map(v=>v.message).join(" ")||e.message);return null;}
    finally{running.current=false;setBusy(false);}
  }
  return {run,busy,error,uncertain,locked:busy||uncertain,setError};
}
