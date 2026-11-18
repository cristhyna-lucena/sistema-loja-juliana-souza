import type { SVGProps } from "react";
const paths = {
  user: "M20 21v-2a7 7 0 0 0-14 0v2M13 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  box: "m12 3 9 5-9 5-9-5 9-5ZM3 8v9l9 5 9-5V8M12 13v9M7.5 5.5l9 5",
  layers: "m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5",
  wallet: "M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7m18 6h-5v4h5M17 15h.01",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  settings: "M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8",
  search: "M10.5 3a7.5 7.5 0 1 0 0 15 7.5 7.5 0 0 0 0-15ZM16 16l5 5",
  plus: "M12 5v14M5 12h14",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  chevron: "m9 5 7 7-7 7",
  refresh: "M20 7v5h-5M4 17v-5h5M6.1 6a8 8 0 0 1 12.5 1L20 12M4 12l1.4 5A8 8 0 0 0 18 18",
  image: "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM3 16l5-5 5 5 3-3 5 5M15 7h.01",
  pencil: "m15 4 5 5M4 20l4-1L21 6l-5-5L3 14l-1 7 2-1Z",
  check: "m5 12 4 4L19 6",
  logout: "M9 4H4v16h5M13 8l5 4-5 4M7 12h13",
  lock: "M6 10h12v11H6zM8 10V7a4 4 0 0 1 8 0v3M12 14v3",
  mail: "M3 5h18v14H3zM3 6l9 7 9-7",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12ZM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
  eyeOff: "M3 3l18 18M10 5a12 12 0 0 1 12 7 18 18 0 0 1-4 4M6 6a19 19 0 0 0-4 6s4 7 10 7a12 12 0 0 0 5-1M9 9a4 4 0 0 0 6 6",
  calendar: "M4 5h16v16H4zM8 2v6M16 2v6M4 10h16",
  clock: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM12 6v6l4 2",
  leaf: "M20 3C9 2 3 8 4 14c1 6 7 8 11 4 4-3 5-9 5-15ZM5 19 16 8",
} as const;
export type IconName=keyof typeof paths;
export function Icon({name,size=20,...props}:{name:IconName;size?:number}&SVGProps<SVGSVGElement>){return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}><path d={paths[name]}/></svg>;}
export function BrandMark({className=""}:{className?:string}){return <span className={"brand-mark "+className} aria-hidden="true"><svg width="28" height="28" viewBox="0 0 32 32" fill="none"><path d="M16 16C7 17 4 12 5 5c7-1 12 2 11 11ZM16 16C15 7 20 4 27 5c1 7-2 12-11 11ZM16 16c9-1 12 4 11 11-7 1-12-2-11-11ZM16 16c1 9-4 12-11 11-1-7 2-12 11-11Z" fill="currentColor"/></svg></span>;}
