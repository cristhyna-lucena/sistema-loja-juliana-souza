import type { SVGProps } from "react";

const paths = {
  user: "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM4 21v-3a8 8 0 0 1 16 0v3",
  bag: "M4 7h16l1 14H3L4 7ZM8 8V6a4 4 0 0 1 8 0v2",
  menu: "M3 6h18M3 12h18M3 18h18",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5",
  heart: "M12 21S2 15 2 8a5 5 0 0 1 10-1A5 5 0 0 1 22 8c0 7-10 13-10 13Z",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  diamond: "M12 3 2 8l10 13L22 8 12 3ZM2 8h20M7 8l5 13 5-13",
  leaf: "M20 3C9 2 3 8 4 14c1 6 7 8 11 4 4-3 5-9 5-15ZM5 19 16 8",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  play: "m9 5 11 7-11 7V5Z",
} as const;
export function StoreIcon({name,...props}:{name:keyof typeof paths}&SVGProps<SVGSVGElement>){
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}><path d={paths[name]}/></svg>;
}

export function Butterfly({className=""}:{className?:string}){
  return <svg className={`butterfly ${className}`} width="90" height="80" viewBox="0 0 100 90" fill="none" aria-hidden="true" focusable="false"><g fill="currentColor" fillOpacity=".15" stroke="currentColor" strokeWidth="1.2"><path d="M50 58C28 50 3 19 13 7c11-13 37 24 37 51ZM50 58C72 50 97 19 87 7 76-6 50 31 50 58ZM48 58C26 47 14 66 24 76c10 11 22-3 26-16ZM52 58c22-11 34 8 24 18-10 11-22-3-26-16Z"/><path d="M50 77V44m0 2-9-13m9 13 9-13M18 16l29 38M82 16 53 54M24 66l21-7m31 7-21-7"/></g></svg>;
}

export function LineCampaign({id,title,description,onView,tone="sakura"}:{id:string;title:string;description:string;onView:()=>void;tone?:string}){
  return <section className={`line-campaign campaign-${tone}`} aria-labelledby={`campaign-${id}-title`}>
    <div className="campaign-art"><img src={`/products/${id}.webp`} alt={`Produtos da linha ${title}`} width="700" height="600" loading="lazy"/></div>
    <div className="campaign-copy"><p className="eyebrow">UM RITUAL DE CARINHO</p><h2 id={`campaign-${id}-title`}>{title}</h2><p>{description}</p><button className="primary-link" type="button" onClick={onView}>Conheça a linha <StoreIcon name="arrow"/></button></div>
    <Butterfly className="campaign-butterfly"/>
  </section>;
}

export type CareClip={id:string;product:string;poster:string;src:string;caption:string;captions?:string};
// Publicar somente arquivos com autorização. Nenhum vídeo demonstrativo é tratado como depoimento real.
export const authorizedClips:CareClip[]=[];
const comingSoon=[{id:"sakura",name:"Sakura Essencial Care"},{id:"lumine",name:"Lúminë"},{id:"ritual",name:"Ritual dos Cachos"}];
export function CareVideos({clips=authorizedClips}:{clips?:CareClip[]}){
  return <section className="care-videos wrap" id="videos" aria-labelledby="videos-title">
    <div className="section-heading centered"><p className="eyebrow">HISTÓRIAS E RITUAIS</p><h2 id="videos-title">O cuidado na vida real</h2><p>{clips.length?"Demonstrações para conhecer cada cuidado mais de perto.":"Em breve, demonstrações e experiências em vídeos curtos."}</p></div>
    <div className="video-carousel" role="list" aria-label="Vídeos de cuidados" tabIndex={0}>
      {clips.length?clips.map(clip=><article className="video-card" key={clip.id} role="listitem"><video controls playsInline preload="none" poster={clip.poster} aria-label={clip.caption}>{/* A reprodução sempre depende de uma ação da usuária. */}<source src={clip.src}/>{clip.captions&&<track kind="captions" src={clip.captions} srcLang="pt-BR" label="Português" default/>}Seu navegador não suporta vídeo.</video><div><h3>{clip.product}</h3><p>{clip.caption}</p></div></article>):comingSoon.map(item=><article className="video-card video-coming" key={item.id} role="listitem"><div className="video-poster"><span className="coming-badge">Vídeos em breve</span><img src={`/products/${item.id}.webp`} alt={`Linha ${item.name}`} width="400" height="500" loading="lazy"/><span className="video-ornament" aria-hidden="true"><StoreIcon name="leaf"/></span></div><div><h3>{item.name}</h3><p>Um novo jeito de conhecer o seu cuidado.</p></div></article>)}
    </div>
  </section>;
}
