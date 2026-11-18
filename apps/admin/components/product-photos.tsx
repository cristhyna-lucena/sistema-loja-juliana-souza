"use client";
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { MAX_PHOTOS, MAX_PHOTO_BYTES, MAX_PHOTO_PIXELS, type FotoDTO, type FotoUploadDTO, type GaleriaDTO } from "@sistema/shared";
function mime(file: File) { const ext = file.name.split(".").pop()?.toLowerCase(); return ({jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",heic:"image/heic",heif:"image/heif"} as Record<string,string>)[ext ?? ""] ?? file.type; }
async function prepare(file: File) {
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error("Cada arquivo deve ter até 15 MB.");
  const type = mime(file);
  if (!["image/jpeg","image/png","image/webp","image/heic","image/heif"].includes(type)) throw new Error("Use JPG, PNG, WebP ou HEIC.");
  if (["image/heic","image/heif"].includes(type)) return { body:file, type };
  let image: ImageBitmap;
  try { image = await createImageBitmap(file); } catch { throw new Error("Não foi possível ler esta foto."); }
  const pixels = image.width * image.height; image.close();
  if (pixels > MAX_PHOTO_PIXELS) throw new Error("A imagem deve ter até 40 megapixels.");
  const compression = (await import("browser-image-compression")).default;
  const body = await compression(file,{maxSizeMB:1,maxWidthOrHeight:2560,useWebWorker:false,preserveExif:false,fileType:type,initialQuality:0.85});
  if (body.size > MAX_PHOTO_BYTES) throw new Error("A imagem deve ter até 15 MB.");
  return { body, type: body.type || type };
}
function put(url: string, body: Blob, type: string, progress: (value:number)=>void, active: {current: XMLHttpRequest | null}) {
  return new Promise<void>((resolve,reject) => {
    const xhr = new XMLHttpRequest(); active.current = xhr;
    xhr.open("PUT",url); xhr.setRequestHeader("Content-Type",type); xhr.timeout=120000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(Math.round(event.loaded/event.total*100)); };
    xhr.onload = () => { active.current=null; if (xhr.status>=200 && xhr.status<300) resolve(); else reject(new Error("O envio não foi concluído. Tente novamente.")); };
    xhr.onerror = xhr.ontimeout = () => { active.current=null; reject(new Error("Não foi possível enviar a foto. Verifique a conexão.")); };
    xhr.onabort = () => { active.current=null; reject(new Error("Envio interrompido.")); };
    xhr.send(body);
  });
}
function PhotoPreview({photo,src,close}:{photo:FotoDTO;src:(id:string,variant:string)=>string;close:()=>void}) {
  const ref=useRef<HTMLDialogElement>(null);
  const [variant,setVariant]=useState("produto.webp");
  useEffect(()=>{ref.current?.showModal();},[]);
  return <dialog className="photo-dialog" ref={ref} onClose={close}><div className="photo-dialog-heading"><h2>Pré-visualização da foto</h2><button type="button" className="secondary" onClick={()=>ref.current?.close()}>Fechar</button></div><label htmlFor="preview-size">Tamanho da prévia</label><select id="preview-size" value={variant} onChange={event=>setVariant(event.target.value)}><option value="card.webp">Card do catálogo</option><option value="produto.webp">Página do produto</option><option value="zoom.webp">Zoom</option></select><img src={src(photo.id,variant)} alt={photo.alt}/></dialog>;
}
function PhotoCard({photo,index,principal,busy,total,src,move,primary,saveAlt,remove,replace,confirm,cancel,dragStart,dragEnd,drop,preview}:{photo:FotoDTO;index:number;principal:boolean;busy:boolean;total:number;src:(id:string,variant:string)=>string;move:(delta:number)=>void;primary:()=>void;saveAlt:(alt:string)=>void;remove:()=>void;replace:(file:File)=>void;confirm:()=>void;cancel:()=>void;dragStart:()=>void;dragEnd:()=>void;drop:()=>void;preview:()=>void}) {
  const [alt,setAlt]=useState(photo.alt);
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>setAlt(photo.alt),[photo.alt]);
  const pending=["AGUARDANDO_UPLOAD","PROCESSANDO"].includes(photo.status);
  return <li className="photo-card" data-photo-id={photo.id} draggable={!busy && total>1} onDragStart={event=>{if ((event.target as HTMLElement).tagName==="INPUT") {event.preventDefault();return;} event.dataTransfer.setData("text/plain",photo.id);dragStart();}} onDragEnd={dragEnd} onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();if(!event.dataTransfer.files.length)drop();}}>
    <div className="photo-frame">{photo.temFoto ? <img src={src(photo.id,"thumb.webp")+"?v="+photo.hash} alt={photo.alt} loading="lazy"/> : <p>{photo.status==="ERRO"?"Arquivo não disponível":"Aguardando foto"}</p>}{principal && <span className="photo-primary">Principal</span>}</div>
    <p className="photo-state" role="status">{photo.status==="PRONTA"?"Foto pronta":photo.status==="PROCESSANDO"?"Processando foto…":photo.status==="AGUARDANDO_UPLOAD"?"Aguardando envio…":"Falha no envio"}</p>{photo.mensagem && <p className="field-error">{photo.mensagem}</p>}
    <label htmlFor={"alt-"+photo.id}>Descrição da foto {index+1}</label><input id={"alt-"+photo.id} value={alt} onChange={event=>setAlt(event.target.value)} maxLength={180} disabled={busy}/>
    <div className="photo-actions"><button type="button" className="secondary" disabled={busy || !alt.trim() || alt.trim()===photo.alt} onClick={()=>saveAlt(alt)}>Salvar descrição</button><button type="button" className="secondary" disabled={busy || !photo.temFoto} onClick={preview}>Ampliar foto {index+1}</button><button type="button" className="secondary" disabled={busy || !photo.temFoto || principal} onClick={primary}>Tornar principal</button><button type="button" className="secondary" aria-label={"Mover foto "+(index+1)+" para cima"} disabled={busy || index===0} onClick={()=>move(-1)}>↑</button><button type="button" className="secondary" aria-label={"Mover foto "+(index+1)+" para baixo"} disabled={busy || index===total-1} onClick={()=>move(1)}>↓</button>
    <input className="sr-only" ref={input} type="file" accept=".jpg,.jpeg,.png,.webp,.heic,.heif" aria-label={"Trocar arquivo da foto "+(index+1)} disabled={busy || pending} onChange={event=>{const file=event.target.files?.[0];event.target.value="";if(file)replace(file);}}/>
    <button type="button" className="secondary" disabled={busy || pending} onClick={()=>input.current?.click()}>Trocar arquivo</button>{photo.status==="AGUARDANDO_UPLOAD" && <button type="button" className="secondary" disabled={busy} onClick={confirm}>Concluir envio</button>}{pending && <button type="button" className="secondary" disabled={busy} onClick={cancel}>Cancelar envio</button>}<button type="button" className="secondary danger" disabled={busy} onClick={remove}>Remover foto</button></div>
  </li>;
}
export function ProductPhotos({produtoId,nomeProduto}:{produtoId:string;nomeProduto:string}) {
  const base="/api/fotos/produtos/"+encodeURIComponent(produtoId)+"/imagens";
  const [gallery,setGallery]=useState<GaleriaDTO|null>(null);
  const [error,setError]=useState("");const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);const [progress,setProgress]=useState(0);const [uploading,setUploading]=useState(false);
  const [newAlt,setNewAlt]=useState(nomeProduto.slice(0,180));const [preview,setPreview]=useState<FotoDTO|null>(null);
  const busyRef=useRef(false);const active=useRef<XMLHttpRequest|null>(null);const sequence=useRef(0);const dragging=useRef<string|null>(null);const addInput=useRef<HTMLInputElement>(null);
  const src=(id:string,variant:string)=>base+"/"+encodeURIComponent(id)+"/arquivo/"+variant;
  const request=useCallback(async<T,>(suffix:string,method="GET",body?:unknown):Promise<T>=>{
    const response=await fetch(base+suffix,{method,cache:"no-store",headers:{"Content-Type":"application/json"},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const data=await response.json();
    if(response.status===401){window.location.assign("/login");throw new Error("Entre novamente para continuar.");}
    if(!response.ok)throw new Error(typeof data.message==="string"?data.message:"Não foi possível concluir a operação.");
    return data as T;
  },[base]);
  const load=useCallback(async()=>{const current=++sequence.current;const data=await request<GaleriaDTO>("");if(current===sequence.current)setGallery(data);return data;},[request]);
  useEffect(()=>{let alive=true;void load().catch(()=>{if(alive)setError("Não foi possível carregar as fotos.");});const timer=setInterval(()=>{if(!busyRef.current)void load().catch(()=>{});},2500);return()=>{alive=false;clearInterval(timer);active.current?.abort();};},[load]);
  async function action(suffix:string,body:unknown,method="POST") {
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setError("");setMessage("");
    try {await request(suffix,method,body);await load();setMessage("Galeria atualizada.");}
    catch(error){setError(error instanceof Error?error.message:"Não foi possível atualizar as fotos.");await load().catch(()=>{});}
    finally{busyRef.current=false;setBusy(false);}
  }
  async function send(files:File[],replacement?:string) {
    if(busyRef.current || !files.length)return;
    if(!newAlt.trim()&&!replacement){setError("Descreva as novas fotos.");return;}
    if(!replacement && gallery && gallery.imagens.length+files.length>MAX_PHOTOS){setError("O produto pode ter até oito fotos.");return;}
    busyRef.current=true;setBusy(true);setUploading(true);setError("");setMessage("");
    try{
      for(const [index,file]of files.entries()){
        setProgress(0);setMessage("Preparando foto "+(index+1)+" de "+files.length+"…");
        const prepared=await prepare(file);
        const alt=replacement?gallery?.imagens.find(image=>image.id===replacement)?.alt??newAlt:newAlt;
        const reservation=await request<FotoUploadDTO>("/iniciar","POST",{alt:alt.trim(),tamanho:prepared.body.size,mimeTipo:prepared.type,...(replacement?{substituirId:replacement}:{})});
        await load();setMessage("Enviando foto "+(index+1)+" de "+files.length+"…");
        await put(reservation.url,prepared.body,prepared.type,setProgress,active);
        await request("/"+reservation.id+"/confirmar","POST",{});
        await load();
      }
      setMessage("Envio concluído. As fotos estão sendo preparadas.");
    }catch(error){setMessage("");setError(error instanceof Error?error.message:"Não foi possível enviar a foto.");await load().catch(()=>{});}
    finally{busyRef.current=false;setBusy(false);setUploading(false);}
  }
  function select(event:ChangeEvent<HTMLInputElement>){const files=Array.from(event.currentTarget.files??[]);event.currentTarget.value="";void send(files);}
  function reorder(id:string,target:number){if(!gallery)return;const ids=gallery.imagens.map(photo=>photo.id);const from=ids.indexOf(id);if(from<0||target<0||target>=ids.length||from===target)return;ids.splice(from,1);ids.splice(target,0,id);void action("/ordenar",{ids,versao:gallery.versao});}
  const principal=gallery?.imagens.find(photo=>photo.temFoto)?.id;
  const displayMessage=message==="Envio concluído. As fotos estão sendo preparadas." && !!gallery?.imagens.length && gallery.imagens.every(photo=>!["AGUARDANDO_UPLOAD","PROCESSANDO"].includes(photo.status)) ? (gallery.imagens.some(photo=>photo.status==="ERRO") ? "Processamento concluído. Confira as fotos com erro." : "Fotos prontas.") : message;
  return <section id="fotos-produto" className="product-photos" aria-labelledby="photos-title"><div className="page-heading"><div><p className="eyebrow">GALERIA</p><h2 id="photos-title">Fotos do produto</h2><p className="muted">Até oito fotos em JPG, PNG, WebP ou HEIC, com até 15 MB cada.</p></div><span>{gallery?.imagens.length??0} de {MAX_PHOTOS} fotos</span></div>
    <label htmlFor="new-photo-alt">Descrição das novas fotos</label><input id="new-photo-alt" value={newAlt} onChange={event=>setNewAlt(event.target.value)} maxLength={180} disabled={busy}/>
    <div className="photo-dropzone" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();void send(Array.from(event.dataTransfer.files));}}><p>Arraste as fotos para cá ou escolha os arquivos.</p><input className="sr-only" ref={addInput} type="file" multiple accept=".jpg,.jpeg,.png,.webp,.heic,.heif" aria-label="Selecionar fotos do produto" disabled={busy||!gallery||gallery.imagens.length>=MAX_PHOTOS} onChange={select}/><button type="button" disabled={busy||!gallery||gallery.imagens.length>=MAX_PHOTOS} onClick={()=>addInput.current?.click()}>Adicionar fotos</button></div>
    <p className="muted">A primeira foto disponível é a principal. Arraste para ordenar ou use as setas. As fotos são salvas ao concluir o envio.</p>
    {uploading&&<progress max={100} value={progress} aria-label="Progresso do envio"/>}{displayMessage&&<p role="status" className="photo-message">{displayMessage}</p>}{error&&<p role="alert">{error}</p>}
    {!gallery?<button type="button" className="secondary" onClick={()=>void load().then(()=>setError("")).catch(()=>setError("Não foi possível carregar as fotos."))}>Atualizar galeria</button>:<ol className="photo-grid">{gallery.imagens.map((photo,index)=><PhotoCard key={photo.id} photo={photo} index={index} total={gallery.imagens.length} principal={photo.id===principal} busy={busy} src={src} move={delta=>reorder(photo.id,index+delta)} primary={()=>reorder(photo.id,0)} saveAlt={alt=>void action("/"+photo.id,{alt,versao:gallery.versao},"PATCH")} remove={()=>void action("/"+photo.id+"/remover",{versao:gallery.versao})} replace={file=>void send([file],photo.id)} confirm={()=>void action("/"+photo.id+"/confirmar",{})} cancel={()=>void action("/"+photo.id+"/cancelar",{versao:gallery.versao})} dragStart={()=>{dragging.current=photo.id;}} dragEnd={()=>{dragging.current=null;}} drop={()=>{if(dragging.current)reorder(dragging.current,index);dragging.current=null;}} preview={()=>setPreview(photo)}/>)}</ol>}
    {!!gallery?.removidas.length&&<details className="removed-photos"><summary>Fotos removidas ({gallery.removidas.length})</summary><p>Você pode restaurar uma foto por até sete dias após a remoção.</p>{gallery.removidas.map(photo=><div key={photo.id} className="removed-photo"><span>{photo.alt}{photo.restauravelAte&&<small>Disponível até {new Date(photo.restauravelAte).toLocaleDateString("pt-BR")}</small>}</span><button type="button" className="secondary" disabled={busy} onClick={()=>void action("/"+photo.id+"/restaurar",{versao:gallery.versao})}>Restaurar foto</button></div>)}</details>}
    {preview&&<PhotoPreview photo={preview} src={src} close={()=>setPreview(null)}/>}
  </section>;
}
