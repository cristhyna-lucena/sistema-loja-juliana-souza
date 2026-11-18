export function dataLoja(agora = new Date()) {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Cuiaba", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
  const parte = (type: string) => partes.find(p => p.type === type)!.value;
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}
export function somarDias(data: string, dias: number) { return new Date(new Date(data + "T00:00:00.000Z").getTime() + dias * 86400000).toISOString().slice(0, 10); }
