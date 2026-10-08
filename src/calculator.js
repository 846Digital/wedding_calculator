import { CITIES, TIERS, SERVICES, DEFAULT_SELECTED, PRICE_DATE } from './data.js';

export const money = value => new Intl.NumberFormat('ru-RU', { style:'currency', currency:'RUB', maximumFractionDigits:0 }).format(Number.isFinite(value) ? value : 0);
export const number = value => new Intl.NumberFormat('ru-RU', { maximumFractionDigits:2 }).format(value);
export const bounded = (value, fallback, min=0, max=1000000) => {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max,Math.max(min,n)) : fallback;
};
export function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year,month,day] = value.split('-').map(Number);
  if (year < 2020 || year > 2040) return null;
  const date = new Date(Date.UTC(year,month-1,day,12));
  return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day ? date : null;
}
export function prettyDate(value, options={}) {
  const d=parseDate(value);
  return d ? new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC',...options}).format(d) : 'Дата не выбрана';
}
export function createState() {
  return {
    city:'moscow', tier:'comfort', format:'classic', date:'2027-06-19', adults:50, children:0,
    venueType:'restaurant', selected:[...DEFAULT_SELECTED], serviceFee:10, reserve:10,
    minFood:0, organizer:false, organizerFee:10, specialDate:false, futureAdjustment:0,
    overrides:{}, quantities:{}, custom:[], dateOverrides:{},
  };
}
export function sanitizeState(raw={}) {
  const base=createState();
  const source=raw && typeof raw==='object' && !Array.isArray(raw) ? raw : {};
  const knownIds=new Set(SERVICES.map(s=>s.id));
  const selected=Array.isArray(source.selected) ? [...new Set(source.selected.filter(id=>knownIds.has(id)))] : base.selected;
  const map = (input,max) => Object.fromEntries(SERVICES.filter(s=>input && Object.hasOwn(input,s.id) && Number.isFinite(input[s.id]) && input[s.id]>=0).map(s=>[s.id,Math.min(max,input[s.id])]));
  const state={
    city:CITIES.some(c=>c.id===source.city) ? source.city : base.city,
    tier:TIERS.some(t=>t.id===source.tier) ? source.tier : base.tier,
    format:['two','intimate','classic','large','custom'].includes(source.format) ? source.format : base.format,
    date:parseDate(source.date) ? source.date : '',
    adults:Math.round(bounded(source.adults,base.adults,2,500)),
    children:Math.round(bounded(source.children,0,0,150)),
    venueType:['restaurant','loft','country','tent'].includes(source.venueType) ? source.venueType : base.venueType,
    selected, serviceFee:bounded(source.serviceFee,10,0,30), reserve:bounded(source.reserve,10,0,30),
    minFood:bounded(source.minFood,0,0,5000000), organizer:source.organizer===true,
    organizerFee:bounded(source.organizerFee,10,0,30), specialDate:source.specialDate===true,
    futureAdjustment:bounded(source.futureAdjustment,0,0,100),
    overrides:map(source.overrides,1000000), quantities:map(source.quantities,10000),
    custom:Array.isArray(source.custom) ? source.custom.slice(0,30).filter(c=>c && typeof c.name==='string' && c.name.trim()).map((c,i)=>({id:'custom-'+i,name:c.name.trim().slice(0,100),amount:bounded(c.amount,0,0,5000000)})) : [],
    dateOverrides:Object.fromEntries(['venueDay','venueSeason','teamDay','teamSeason','specialVenue','specialTeam'].filter(k=>source.dateOverrides && Object.hasOwn(source.dateOverrides,k) && Number.isFinite(source.dateOverrides[k])).map(k=>[k,bounded(source.dateOverrides[k],0,-50,100)])),
  };
  return state;
}

export function dateFactors(state,city) {
  const d=parseDate(state.date);
  const weekday=d?.getUTCDay();
  const month=d ? d.getUTCMonth()+1 : null;
  const peak=month!==null && city.peakMonths.includes(month);
  const venueDay=d ? ({5:city.friday,6:city.saturday,0:city.sunday}[weekday] || 0) : 0;
  const teamDay=d ? ({5:5,6:10,0:0}[weekday] || 0) : 0;
  const md=d ? `${String(month).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}` : '';
  const federalHoliday=/^01-0[1-8]$/.test(md) || ['02-23','03-08','05-01','05-09','06-12','11-04'].includes(md);
  const special=state.specialDate || federalHoliday;
  const defaults={venueDay,venueSeason:peak?city.peakVenue:0,teamDay,teamSeason:peak?city.peakTeam:0,specialVenue:special?20:0,specialTeam:special?10:0};
  const values={...defaults,...state.dateOverrides};
  // Percentages add relative to the base rate; no compounded opaque multipliers.
  return {weekday,month,peak,federalHoliday,special,defaults,...values,
    venue:Math.max(0,1+(values.venueDay+values.venueSeason+values.specialVenue)/100),
    team:Math.max(0,1+(values.teamDay+values.teamSeason+values.specialTeam)/100),
  };
}

export function defaultQuantity(service,state) {
  const g=state.adults+state.children;
  return ({one:1,two:2,adults:state.adults,children:state.children,guests:g,bottles:Math.ceil(state.adults/2),cake:Math.max(2,Math.ceil(g*.15*10)/10),barHours:5,crew:8,overtime:1,hostHours:6,photoHours:8,coordHours:10,four:4,six:6,three:3,five:5,tables:Math.ceil(g/8),invitations:Math.ceil(g/2),buses:Math.ceil(g/20),cars:Math.ceil(g/3)})[service.quantity] ?? 1;
}

export function lineFor(service,state,city,tier,factors) {
  const quantity=Object.hasOwn(state.quantities,service.id) ? state.quantities[service.id] : defaultQuantity(service,state);
  const manual=Object.hasOwn(state.overrides,service.id);
  const parentMenuQuote=service.id==='kidsMeal'&&!manual&&Object.hasOwn(state.overrides,'meal');
  const tierFactor=tier[service.tier] ?? 1;
  const locationFactor=service.id==='venue' ? ({restaurant:1,loft:1.15,country:1.4,tent:1.6}[state.venueType]) : 1;
  const baseRate=service.rate==='fixed' ? service.ratio : city.rates[service.rate]*service.ratio;
  const base=baseRate*tierFactor*locationFactor;
  const dateMultiplier=service.dateScope==='venue' ? factors.venue : service.dateScope==='team' ? factors.team : 1;
  const adjusted=manual ? state.overrides[service.id] : parentMenuQuote ? Math.round(state.overrides.meal*.6/10)*10 : Math.round(base*dateMultiplier*(1+state.futureAdjustment/100)/10)*10;
  const rate=service.rate==='fixed' && !manual ? service.ratio : adjusted;
  const amount=Math.round(rate*quantity);
  return {id:service.id,group:service.group,name:service.name,description:service.description,unit:service.unit,quantity,rate,amount,manual,dateScope:service.dateScope,
    dateAddition:manual || service.rate==='fixed' ? 0 : Math.round(base*(dateMultiplier-1)*(1+state.futureAdjustment/100)*quantity),
    low:manual || service.rate==='fixed' ? amount : Math.round(amount*.8),
    high:manual || service.rate==='fixed' ? amount : Math.round(amount*1.25),
  };
}

export function calculate(raw) {
  const state=sanitizeState(raw);
  const city=CITIES.find(c=>c.id===state.city);
  const tier=TIERS.find(t=>t.id===state.tier);
  const factors=dateFactors(state,city);
  const lines=SERVICES.filter(s=>state.selected.includes(s.id)).map(s=>lineFor(s,state,city,tier,factors)).filter(l=>l.quantity>0);
  const food=lines.filter(l=>['meal','kidsMeal'].includes(l.id)).reduce((sum,l)=>sum+l.amount,0);
  // A minimum food order applies only if a food service is selected.
  const minimumAddition=lines.some(l=>['meal','kidsMeal'].includes(l.id)) ? Math.max(0,state.minFood-food) : 0;
  if(minimumAddition) lines.push({id:'minimum',group:'banquet',name:'Доплата до минимального заказа кухни',description:'Минимум кухни минус стоимость взрослого и детского меню.',quantity:1,unit:'доплата',rate:minimumAddition,amount:minimumAddition,manual:true,low:minimumAddition,high:minimumAddition,dateAddition:0});
  const feeBase=food+minimumAddition;
  const service=Math.round(feeBase*state.serviceFee/100);
  const foodLow=lines.filter(l=>['meal','kidsMeal'].includes(l.id)).reduce((sum,l)=>sum+l.low,0);
  const foodHigh=lines.filter(l=>['meal','kidsMeal'].includes(l.id)).reduce((sum,l)=>sum+l.high,0);
  const minActive=lines.some(l=>['meal','kidsMeal'].includes(l.id));
  const serviceLow=Math.round((minActive?Math.max(foodLow,state.minFood):0)*state.serviceFee/100);
  const serviceHigh=Math.round((minActive?Math.max(foodHigh,state.minFood):0)*state.serviceFee/100);
  if(service) lines.push({id:'serviceFee',group:'banquet',name:'Обслуживание банкета',description:`${number(state.serviceFee)}% от кухни с учётом минимального заказа; без напитков и торта.`,quantity:state.serviceFee,unit:'%',rate:feeBase/100,amount:service,manual:false,low:serviceLow,high:serviceHigh,dateAddition:0});
  state.custom.forEach(c=>lines.push({id:c.id,group:'custom',name:c.name,quantity:1,unit:'расход',rate:c.amount,amount:c.amount,manual:true,low:c.amount,high:c.amount,dateAddition:0}));
  const sum=key=>lines.reduce((n,l)=>n+l[key],0);
  const subtotal=sum('amount');
  // Adjust low/high minimum order top-ups rather than counting the typical top-up twice.
  let low=sum('low'), high=sum('high');
  if(minActive) {low+=Math.max(0,state.minFood-foodLow)-minimumAddition;high+=Math.max(0,state.minFood-foodHigh)-minimumAddition;}
  const organizer=state.organizer ? Math.round(subtotal*state.organizerFee/100) : 0;
  const organizerLow=state.organizer ? Math.round(low*state.organizerFee/100) : 0;
  const organizerHigh=state.organizer ? Math.round(high*state.organizerFee/100) : 0;
  if(organizer) lines.push({id:'organizer',group:'team',name:'Организация свадьбы',description:`${number(state.organizerFee)}% от всех расходов до резерва. Координатор считается отдельно.`,quantity:state.organizerFee,unit:'%',rate:subtotal/100,amount:organizer,manual:false,low:organizerLow,high:organizerHigh,dateAddition:0});
  const beforeReserve=subtotal+organizer;
  const reserve=Math.round(beforeReserve*state.reserve/100);
  const total=beforeReserve+reserve;
  const rangeLow=low+organizerLow+Math.round((low+organizerLow)*state.reserve/100);
  const rangeHigh=high+organizerHigh+Math.round((high+organizerHigh)*state.reserve/100);
  const groups=Object.fromEntries([...new Set(lines.map(l=>l.group))].map(group=>[group,lines.filter(l=>l.group===group).reduce((n,l)=>n+l.amount,0)]));
  const restaurantIds=['meal','kidsMeal','minimum','soft','alcohol','corkage','cake','welcome','dessert','barDrinks','teamMeal','serviceFee','welcomeBubbles','foodStation','lateSnack'];
  const restaurantTotal=lines.filter(l=>restaurantIds.includes(l.id)).reduce((n,l)=>n+l.amount,0);
  return {state,city,tier,factors,lines,groups,subtotal,beforeReserve,reserve,total,low:Math.min(rangeLow,total),high:Math.max(rangeHigh,total),perGuest:Math.round(total/(state.adults+state.children)),restaurantTotal,restaurantPerGuest:Math.round(restaurantTotal/(state.adults+state.children)),dateAddition:lines.reduce((n,l)=>n+l.dateAddition,0),priceDate:PRICE_DATE};
}

export function csvCell(value) {
  let safe=String(value ?? '');
  // Excel formula injection protection, including whitespace before a formula.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(safe)) safe="'"+safe;
  return '"'+safe.replaceAll('"','""')+'"';
}
export function exportCsv(result) {
  const rows=[['Калькулятор свадьбы — предварительная смета'],['Город',result.city.name],['Регион',result.city.region],['Дата',prettyDate(result.state.date)],['Уровень',result.tier.name],['Взрослых (включая пару)',result.state.adults],['Детей',result.state.children],['Цены проверены',PRICE_DATE],[],['Позиция','Количество','Единица','Цена за единицу, ₽','Сумма, ₽','Основание'],...result.lines.map(l=>[l.name,l.quantity,l.unit,l.rate,l.amount,l.manual?'Своя цена / фиксированная сумма':'Расчётный ориентир']),['Резерв',result.state.reserve,'%',result.beforeReserve/100,result.reserve,'От расходов с организацией'],['ИТОГО','','','',result.total],['Сценарный диапазон','','','',`${result.low}–${result.high}`],[],['Надбавки к базовым ставкам, %','Площадка: день','Площадка: сезон','Площадка: популярная дата','Команда: день','Команда: сезон','Команда: популярная дата'],['',result.factors.venueDay,result.factors.venueSeason,result.factors.specialVenue,result.factors.teamDay,result.factors.teamSeason,result.factors.specialTeam],['Индексация всех модельных цен, %',result.state.futureAdjustment],[],['Диапазон — сценарий −20% / +25% по модельным услугам, не статистический интервал и не оферта.'],['Свои цены считаются окончательными; коэффициенты даты и уровня к ним не применяются.'],[],['Источники города','Ссылка','Наблюдение'],...result.city.sources.map(s=>[s.title,s.url,s.observed])];
  const menu=lineFor(SERVICES.find(s=>s.id==='meal'),result.state,result.city,result.tier,result.factors);
  rows.splice(8,0,['Расчётный / свой чек взрослого меню, ₽',menu.rate],['Банкет с выбранными доплатами, ₽',result.restaurantTotal],['Банкет на гостя, ₽',result.restaurantPerGuest],['Банкетная сумма включает выбранные меню, напитки, торт, фуршет, питание команды и сервис; без аренды, организации и резерва.']);
  return '\ufeff'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n');
}
