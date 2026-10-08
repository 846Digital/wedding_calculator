import {CITIES,SERVICES} from './data.js';
import {SUPPLIERS,SUPPLIER_TYPES,PLATFORMS} from './suppliers.js';

// Explicit mapping avoids treating a florist's price base as a makeup service.
const assignments={
  venue:['meal','kidsMeal','venue','soft','alcohol','corkage','teamMeal','overtime','ceremonySite','tasting','welcomeBubbles','tips'],
  host:['host','officiant'], photo:['photo','secondPhoto','loveStory','photoAlbum','expressPhoto'],
  video:['video','content','loveVideo','drone','liveStream'],
  planner:['coordinator','ceremonyRehearsal','ceremonyDirector'],
  decor:['arch','chairs','vows','petals','tableDecor','bouquet','photozone','textiles','candles','printing','invitations','decorDelivery','concept','extraFlowers','signage'],
  dj:['dj','afterpartyDj'],
  tech:['ceremonySound','sound','light','screen','furniture','tent','generator','climate','soundEngineer','lightOperator','technicalProducer','ledScreen','techMounting','techDelivery','backupInternet'],
  effects:['coldFountains','lowFog','fireworks','confettiCannon'],
  transfer:['car','bus','crewTransfer','guestTaxi'],
  beauty:['beauty','trial','groom','stylistSupport','guestLooks'],
  cake:['cake','dessert','cakeDelivery'], catering:['welcome','bar','barDrinks','foodStation','lateSnack'],
  entertainment:['ceremonyMusic','band','show','kidsAnimator','photobooth','dance','quartet','welcomeMusician','singer','magician'],
  attire:['dress','suit','accessories','secondLook'],
};
export function selectedSupplierTypes(state){
  const selected=new Set(Array.isArray(state?.selected)?state.selected:[]);
  const types=Object.entries(assignments).filter(([,ids])=>ids.some(id=>selected.has(id))).map(([kind])=>kind);
  if(state?.organizer&&!types.includes('planner'))types.push('planner');
  return types;
}
export function unmappedServices(state){
  const mapped=new Set(Object.values(assignments).flat());
  return SERVICES.filter(service=>state?.selected?.includes(service.id)&&!mapped.has(service.id));
}
export function matchSuppliers({city,type='all',scope='city',platform='all',sort='name',ratedOnly=false,minRating=0,state={}}={}){
  const location=CITIES.find(c=>c.id===city);
  if(!location||!Object.hasOwn(SUPPLIER_TYPES,type)||!Number.isFinite(minRating)||minRating<0||minRating>5)return [];
  const kinds=type==='other'?selectedSupplierTypes(state):[type];
  const records=SUPPLIERS.filter(provider=>{
    const providerCity=CITIES.find(c=>c.id===provider.city);
    const samePlace=scope==='region'?(providerCity?.region||provider.region)===location.region:provider.city===city;
    const sources=provider.sources.filter(source=>platform==='all'||source.platform===platform);
    return samePlace&&(type==='all'||provider.kinds.some(kind=>kinds.includes(kind)))&&sources.length>0&&(!(ratedOnly||minRating>0)||sources.some(s=>Number.isFinite(s.rating)&&s.rating>=minRating));
  }).map(provider=>({...provider,sources:provider.sources.filter(s=>platform==='all'||s.platform===platform)}));
  // Ratings from different platforms are not aggregated or compared as one rank.
  return records.sort((a,b)=>{
    if(sort==='rating'&&Object.hasOwn(PLATFORMS,platform)){
      const difference=(b.sources[0].rating??-1)-(a.sources[0].rating??-1);
      if(difference)return difference;
      const countDifference=b.sources[0].count-a.sources[0].count;if(countDifference)return countDifference;
    }
    return a.name.localeCompare(b.name,'ru');
  });
}
export function ratingLabel(source){
  return source.rating===null?'Без числового рейтинга':`${source.rating.toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:2})} из 5`;
}
export function reviewScoreLabel(source){
  const scores=source.reviewScores;
  return scores?`${scores.good.toLocaleString('ru-RU')} «Хорошо» · ${scores.neutral.toLocaleString('ru-RU')} «Нормально» · ${scores.bad.toLocaleString('ru-RU')} «Плохо»`:'';
}
export function countLabel(source){
  const n=source.count, ending=n%100>=11&&n%100<=14?2:n%10===1?0:n%10>=2&&n%10<=4?1:2;
  const words=source.countType==='reviews'?['отзыв','отзыва','отзывов']:['оценка','оценки','оценок'];
  return `${n.toLocaleString('ru-RU')} ${words[ending]}`;
}

const queries={venue:'банкетные залы',host:'ведущий на свадьбу',photo:'свадебный фотограф',video:'свадебный видеограф',decor:'свадебная флористика декор',planner:'свадебное агентство',dj:'диджей на свадьбу',tech:'аренда звука и света',effects:'профессиональные фейерверки',transfer:'аренда автобуса на свадьбу',beauty:'свадебный стилист',cake:'свадебный торт',catering:'кейтеринг на свадьбу',entertainment:'кавер группа на свадьбу',attire:'свадебный салон'};
const avitoCities={moscow:'moskva',spb:'sankt-peterburg',samara:'samara',kazan:'kazan',ekb:'ekaterinburg',nsk:'novosibirsk',nn:'nizhniy_novgorod',krasnodar:'krasnodar',rostov:'rostov-na-donu',sochi:'sochi',voronezh:'voronezh',ufa:'ufa',perm:'perm',tyumen:'tyumen',chelyabinsk:'chelyabinsk',krasnoyarsk:'krasnoyarsk',omsk:'omsk',volgograd:'volgograd'};
const dgisCities={...avitoCities,moscow:'moscow',spb:'spb',nn:'n_novgorod',rostov:'rostov'};
// Only city/region and a fixed service query are transmitted. Never include the estimate.
export function supplierSearches({city,scope='city',type='venue',state={}}={}){
  const location=CITIES.find(c=>c.id===city);
  if(!location||!['city','region'].includes(scope)||!Object.hasOwn(SUPPLIER_TYPES,type))return [];
  const place=scope==='region'?location.region:location.name;
  const kinds=type==='all'?Object.keys(queries):type==='other'?selectedSupplierTypes(state):[type];
  return kinds.filter(kind=>Object.hasOwn(queries,kind)).map(kind=>{
    const text=`${queries[kind]} ${place}`,encoded=encodeURIComponent(text);
    return {kind,label:SUPPLIER_TYPES[kind],place,text,
      yandex:'https://yandex.ru/maps/?text='+encoded,
      widget:'https://yandex.ru/map-widget/v1/?lang=ru_RU&text='+encoded,
      dgis:'https://2gis.ru/'+dgisCities[city]+'/search/'+encoded,
      // For regional searches the chosen region is part of the query; Avito's location filter is set on its own site.
      avito:'https://www.avito.ru/'+(scope==='city'?avitoCities[city]:'rossiya')+'/uslugi?q='+encoded};
  });
}
