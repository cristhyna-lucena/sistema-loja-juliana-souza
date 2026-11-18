import { currentUser } from "../../lib/auth";
import { PanelFrame } from "../../components/panel-frame";
export default async function PanelLayout({children}:{children:React.ReactNode}){const user=await currentUser();return <PanelFrame user={user}>{children}</PanelFrame>;}
