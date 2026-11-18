"use client";
import type { ContaFinanceiraDTO } from "@sistema/shared";
import { formas } from "../lib/comercial-client";
export function AccountFields({contas,contaId,setContaId,forma,setForma}:{contas:ContaFinanceiraDTO[];contaId:string;setContaId:(v:string)=>void;forma:string;setForma:(v:string)=>void}){
  return <><div><label htmlFor="conta-financeira">Conta financeira</label><select id="conta-financeira" required value={contaId} onChange={e=>setContaId(e.target.value)}><option value="">Selecione a conta</option>{contas.filter(c=>c.ativa).map(c=><option key={c.id} value={c.id}>{c.nome}</option>)}</select></div><div><label htmlFor="forma-pagamento">Forma de pagamento</label><select id="forma-pagamento" value={forma} onChange={e=>setForma(e.target.value)}>{Object.entries(formas).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div></>;
}
export function CommercialFeedback({error,uncertain}:{error:string;uncertain?:boolean}){return error?<p role="alert" className="notice">{error}{uncertain&&<span className="muted"> Use o botão novamente para conferir o resultado.</span>}</p>:null;}
