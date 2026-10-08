import {CITIES,TIERS,FORMATS,GROUPS,SERVICES,PRICE_DATE,LEGAL_SOURCES} from './data.js';
import {createState,sanitizeState,calculate,lineFor,defaultQuantity,money,number,parseDate,prettyDate,exportCsv} from './calculator.js';
import {icon,hydrateIcons} from './icons.js';
import {SUPPLIERS,SUPPLIER_TYPES,PLATFORMS,SUPPLIER_CHECKED_AT,SUPPLIER_WEBSITES} from './suppliers.js';
import {matchSuppliers,selectedSupplierTypes,unmappedServices,ratingLabel,countLabel,reviewScoreLabel,supplierSearches} from './matching.js';

const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'?url.href:'#';}catch{return '#';}};
const signedPercent=value=>`${value>0?'+':''}${number(value)}%`;
const external=(url,label,classes='')=>`<a href="${escape(safeUrl(url))}" target="_blank" rel="noopener noreferrer" class="${classes}">${escape(label)}${icon('external')}</a>`;
const PREF_KEY='wedding:privacy:v1', STATE_KEY='wedding:estimate:v1', TTL=90*24*60*60*1000;
let storageAllowed=false, preference=null, state=createState(), result, currentTab='calculator', category='all', search='', selectedOnly=false;
let openGroups=new Set(['banquet','team']), openServices=new Set(), previousState=null, announceTimer, notificationTimer;
let storageAvailable=true;
let liveSearchKey='',liveMapTimer;
const localFeedback=document.querySelector('meta[name="feedback-mode"]')?.content==='local' && location.hostname==='127.0.0.1';

function loadStorage(){
  try{
    const raw=localStorage.getItem(PREF_KEY);
    if(raw){const pref=JSON.parse(raw);if(pref.version===1 && typeof pref.allowed==='boolean' && Number.isFinite(pref.expires) && pref.expires>Date.now() && pref.expires<=Date.now()+TTL+60000){preference=pref;storageAllowed=pref.allowed;}else{localStorage.removeItem(PREF_KEY);localStorage.removeItem(STATE_KEY);}}
    if(storageAllowed){const rawState=localStorage.getItem(STATE_KEY);if(rawState && rawState.length<100000){const saved=JSON.parse(rawState);if(saved.version===1 && saved.expires>Date.now() && saved.expires<=preference.expires)state=sanitizeState(saved.state);else localStorage.removeItem(STATE_KEY);}}
    else if(preference) localStorage.removeItem(STATE_KEY);
  }catch{storageAvailable=false;storageAllowed=false;preference=null;try{localStorage.removeItem(PREF_KEY);localStorage.removeItem(STATE_KEY);}catch{/* Browser storage unavailable; continue in memory. */}}
}
function persist(){if(!storageAllowed||!preference)return;try{localStorage.setItem(STATE_KEY,JSON.stringify({version:1,expires:preference.expires,state:sanitizeState(state)}));}catch{storageAllowed=false;notify('Браузер не разрешил сохранение. Скачайте смету, чтобы сохранить расчёт.');}}
function chooseStorage(allowed){
  storageAllowed=allowed;preference={version:1,allowed,expires:Date.now()+TTL};
  try{localStorage.setItem(PREF_KEY,JSON.stringify(preference));if(!allowed)localStorage.removeItem(STATE_KEY);else persist();}catch{storageAvailable=false;storageAllowed=false;notify('Хранение в браузере недоступно. Расчёт работает без сохранения.');}
  $('storage-banner').hidden=true;
}
function notify(message,undo){clearTimeout(notificationTimer);const node=$('notification');node.replaceChildren(document.createTextNode(message));if(undo){const b=document.createElement('button');b.type='button';b.textContent='Отменить';b.addEventListener('click',()=>{undo();node.hidden=true;});node.append(b);}node.hidden=false;notificationTimer=setTimeout(()=>{if(!node.contains(document.activeElement))node.hidden=true;},undo?10000:6500);}

function populateCore(){
  $('matching-service').replaceChildren(...Object.entries(SUPPLIER_TYPES).map(([value,label])=>new Option(label,value,value==='venue',value==='venue')));
  const regions=[...new Set(CITIES.map(c=>c.region))];
  $('region').innerHTML=regions.map(r=>`<option value="${escape(r)}">${escape(r)}</option>`).join('');
  $('format-options').innerHTML=FORMATS.map(f=>`<label class="format-option"><input type="radio" name="format" value="${f.id}"><span><strong>${f.name}</strong><small>${f.description}</small></span></label>`).join('');
  $('tier-options').innerHTML=TIERS.map(t=>`<label class="tier-option"><input type="radio" name="tier" value="${t.id}"><span><strong>${t.name}</strong><small>${t.description}</small></span></label>`).join('');
  const filterNames={banquet:'Банкет',ceremony:'Церемония',team:'Команда',decor:'Декор',tech:'Техника',look:'Образы',logistics:'Логистика'};
  $('category-filters').innerHTML=`<button type="button" data-category="all" aria-pressed="true">Все услуги</button>`+GROUPS.map(g=>`<button type="button" data-category="${g.id}" aria-pressed="false">${filterNames[g.id]}</button>`).join('');
  syncCore();
}
function syncCities(){const city=CITIES.find(c=>c.id===state.city);$('region').value=city.region;$('city').innerHTML=CITIES.filter(c=>c.region===city.region).map(c=>`<option value="${c.id}">${c.name}</option>`).join('');$('city').value=state.city;}
function syncCore(){
  syncCities();
  for(const [id,key] of Object.entries({'wedding-date':'date',adults:'adults',children:'children','venue-type':'venueType','service-fee':'serviceFee','minimum-food':'minFood','future-adjustment':'futureAdjustment','organizer-fee':'organizerFee',reserve:'reserve'}))$(id).value=state[key];
  $('organizer').checked=state.organizer;$('special-date').checked=state.specialDate;$('organizer-fee').disabled=!state.organizer;
  syncRadios();document.querySelectorAll('[aria-invalid=true]').forEach(n=>n.removeAttribute('aria-invalid'));document.querySelectorAll('.input-validation').forEach(n=>n.remove());$('guest-error').hidden=true;
}
function syncRadios(){document.querySelectorAll('input[name=format]').forEach(n=>n.checked=n.value===state.format);document.querySelectorAll('input[name=tier]').forEach(n=>n.checked=n.value===state.tier);}

function serviceMarkup(service){
  const line=lineFor(service,result.state,result.city,result.tier,result.factors);
  const checked=state.selected.includes(service.id), manual=Object.hasOwn(state.overrides,service.id), manualQuantity=Object.hasOwn(state.quantities,service.id);
  const automatic=['adults','children','guests'].includes(service.quantity) && !['alcohol','barDrinks'].includes(service.id);
  const qty=manualQuantity?state.quantities[service.id]:defaultQuantity(service,state);
  const defaultRate=lineFor(service,{...result.state,overrides:{}},result.city,result.tier,result.factors).rate;
  return `<div class="service-row" data-service="${service.id}"><label class="service-check" for="service-${service.id}"><input type="checkbox" id="service-${service.id}" data-select-service="${service.id}" ${checked?'checked':''}><span><span class="service-name">${escape(service.name)}</span><span class="service-description">${escape(service.description)}</span></span></label><div class="service-price"><div><strong>${money(line.amount)}</strong><small>${number(qty)} ${escape(service.unit)} × ${money(line.rate)}</small></div>${manual?'<span class="manual-tag">Своя цена</span>':''}</div><details class="service-editor" data-editor="${service.id}" ${openServices.has(service.id)?'open':''}><summary>Уточнить ${icon('chevron')}</summary><div class="service-edit-fields"><div class="field"><label for="price-${service.id}">Цена за ${escape(service.unit)}, ₽</label><input type="number" id="price-${service.id}" min="0" max="1000000" step="1" inputmode="decimal" data-price="${service.id}" value="${manual?state.overrides[service.id]:''}" placeholder="${defaultRate}" aria-describedby="edit-error-${service.id}"></div><div class="field"><label for="qty-${service.id}">Количество, ${escape(service.unit)}</label><input type="number" id="qty-${service.id}" min="0" max="10000" step="${service.unit==='кг'?'.1':'1'}" inputmode="decimal" data-quantity="${service.id}" value="${qty}" ${automatic?'disabled':''} aria-describedby="edit-error-${service.id}"></div><span class="field-hint">${automatic?'Количество меняется вместе с числом гостей. ':''}Своя цена — окончательная: дата, уровень и индексация к ней не добавляются.</span><button type="button" class="text-button" data-reset-service="${service.id}">Вернуть расчётную цену и объём</button><p class="service-edit-error" id="edit-error-${service.id}" hidden></p></div></details></div>`;
}

function captureOpen(){document.querySelectorAll('.service-group').forEach(n=>{if(n.open)openGroups.add(n.dataset.group);else openGroups.delete(n.dataset.group);});document.querySelectorAll('.service-editor').forEach(n=>{if(n.open)openServices.add(n.dataset.editor);else openServices.delete(n.dataset.editor);});}
function renderServices(){
  captureOpen();const active=document.activeElement;const activeId=active?.id;
  const normalized=search.toLocaleLowerCase('ru').replaceAll('ё','е');
  const visible=SERVICES.filter(s=>(category==='all'||category===s.group)&&(!selectedOnly||state.selected.includes(s.id))&&(`${s.name} ${s.description}`.toLocaleLowerCase('ru').replaceAll('ё','е').includes(normalized)));
  $('services-list').innerHTML=GROUPS.filter(g=>visible.some(s=>s.group===g.id)).map(g=>{
    const services=visible.filter(s=>s.group===g.id), count=services.filter(s=>state.selected.includes(s.id)).length;
    return `<details class="service-group" data-group="${g.id}" ${openGroups.has(g.id)||category!=='all'||search||selectedOnly?'open':''}><summary><span class="group-icon">${icon(g.icon)}</span><span class="group-title"><strong>${g.name}</strong><small>${g.description} · ${count} из ${services.length} выбрано</small></span><span class="group-amount">${money(result.groups[g.id]||0)}</span><span data-icon="chevron">${icon('chevron')}</span></summary><div>${services.map(serviceMarkup).join('')}</div></details>`;
  }).join('');
  $('services-empty').hidden=visible.length>0;
  $('filter-status').textContent=`Показано ${visible.length} услуг`;
  $('service-total').textContent=`${SERVICES.length} услуг на выбор`;
  if(activeId && $(activeId) && active!==$('service-search'))$(activeId).focus({preventScroll:true});
}

function renderBudget(){
  for(const [id,serviceId] of [['adult-menu-price','meal'],['child-menu-price','kidsMeal']]){
    const input=$(id),service=SERVICES.find(s=>s.id===serviceId);
    if(input.getAttribute('aria-invalid')!=='true')input.value=lineFor(service,result.state,result.city,result.tier,result.factors).rate;
  }
  $('menu-price-hint').textContent=Object.hasOwn(state.overrides,'meal')||Object.hasOwn(state.overrides,'kidsMeal')?'Указана своя окончательная цена. Поправки даты, уровня и индексация к ней не добавляются.':'Расчётный чек меню для выбранного города и уровня. Детский ориентир — 60% взрослого. Можно указать цену ресторана.';
  $('restaurant-total').textContent=money(result.restaurantTotal);
  $('restaurant-per-guest').textContent=`${money(result.restaurantPerGuest)} на гостя`;
  $('budget-location').textContent=`${result.city.name} · ${state.adults+state.children} гостей`;
  $('budget-total').textContent=money(result.total);
  for(const id of ['budget-total','mobile-total'])$(id).dataset.size=result.total>=100000000?'large':result.total>=1000000?'medium':'normal';
  $('budget-range').textContent=`Сценарный диапазон ${money(result.low)} – ${money(result.high)}`;
  const groups=[...GROUPS,{id:'custom',name:'Свои расходы'}].filter(g=>Object.hasOwn(result.groups,g.id));
  $('budget-breakdown').innerHTML=groups.length?groups.map(g=>`<div class="breakdown-row"><span><i class="breakdown-dot" aria-hidden="true"></i>${g.name}</span><strong>${money(result.groups[g.id])}</strong></div>`).join(''):'<p class="budget-range">Выберите услуги, чтобы собрать бюджет.</p>';
  $('reserve-sum').textContent=money(result.reserve);$('per-guest').textContent=money(result.perGuest);$('mobile-total').textContent=money(result.total);
  $('estimate-count').textContent=result.lines.length;
  const d=parseDate(state.date);
  $('date-hint').textContent=d?new Intl.DateTimeFormat('ru-RU',{weekday:'long',timeZone:'UTC'}).format(d):'Без даты надбавки дня и сезона равны 0';
  const f=result.factors;
  $('date-explanation').textContent=`${d?prettyDate(state.date,{year:undefined}):'Дата не выбрана'}${f.peak?' · высокий сезон':''}. Площадка: ${signedPercent(f.venueDay+f.venueSeason+f.specialVenue)}, команда: ${signedPercent(f.teamDay+f.teamSeason+f.specialTeam)}. Только для соответствующих услуг.`;
  const excluded=['alcohol','dress','rings','video','venue'].filter(id=>!state.selected.includes(id)).map(id=>SERVICES.find(s=>s.id===id).name.toLocaleLowerCase('ru'));
  $('budget-tip').textContent=excluded.length?`В смету пока не включены: ${excluded.join(', ')}. Добавьте их, если планируете эти расходы.`:'Проверьте, что входит в пакет площадки: аренда, звук и обслуживание иногда уже включены в меню.';
  clearTimeout(announceTimer);announceTimer=setTimeout(()=>{$('live-budget').textContent=`Примерный бюджет ${money(result.total)}, включая резерв ${money(result.reserve)}.`;},550);
}
function renderCustom(){
  $('custom-list').innerHTML=state.custom.map((c,i)=>`<div class="custom-row"><span>${escape(c.name)}</span><strong>${money(c.amount)}</strong><button type="button" class="icon-button" data-delete-custom="${i}" aria-label="Удалить расход: ${escape(c.name)}">${icon('trash')}</button></div>`).join('');
}
function sourceMarkup(s){return `<div class="source-item">${external(s.url,s.title)}<p>${escape(s.observed)} Проверено ${escape(s.checkedAt)}.</p></div>`;}
function renderEstimate(){
  $('estimate-context').textContent=`${result.city.name} · ${prettyDate(state.date)} · ${state.adults+state.children} гостей`;
  const venueNames={restaurant:'Ресторан / банкетный зал',loft:'Лофт',country:'Загородная площадка',tent:'Шатёр'};
  $('estimate-metadata').innerHTML=[result.tier.name,venueNames[state.venueType],`${state.adults} взрослых + ${state.children} детей`,`Цены: ${PRICE_DATE}`].map(t=>`<span>${escape(t)}</span>`).join('');
  $('estimate-metadata').insertAdjacentHTML('beforeend',`<span>Меню взрослого: ${money(lineFor(SERVICES.find(s=>s.id==='meal'),result.state,result.city,result.tier,result.factors).rate)}</span><span>Банкет и напитки: ${money(result.restaurantTotal)} · ${money(result.restaurantPerGuest)} на гостя</span>`);
  const groups=[...GROUPS,{id:'custom',name:'Свои расходы'}].filter(g=>Object.hasOwn(result.groups,g.id));
  $('estimate-lines').innerHTML=groups.length?groups.map(g=>`<section class="estimate-group" aria-label="${g.name}"><div class="estimate-group-heading"><h3>${g.name}</h3><strong>${money(result.groups[g.id])}</strong></div>${result.lines.filter(l=>l.group===g.id).map(l=>`<div class="estimate-item"><div><p>${escape(l.name)}</p><small>${number(l.quantity)} ${escape(l.unit)} × ${money(l.rate)}${l.manual?' · своя / фиксированная цена':''}</small>${l.description?`<small class="estimate-line-note"> · ${escape(l.description)}</small>`:''}</div><strong>${money(l.amount)}</strong></div>`).join('')}</section>`).join(''):`<div class="empty-state"><h3>В смете пока нет услуг</h3><p>Добавьте нужные услуги в калькуляторе.</p><button type="button" class="secondary-button" data-go-calculator>Выбрать услуги</button></div>`;
  $('estimate-totals').innerHTML=`<div class="estimate-total-row"><span>Расходы до резерва</span><strong>${money(result.beforeReserve)}</strong></div><div class="estimate-total-row"><span>Резерв ${number(state.reserve)}%</span><strong>${money(result.reserve)}</strong></div><div class="estimate-total-row estimate-grand"><span>Итого</span><strong>${money(result.total)}</strong></div><div class="estimate-total-row"><span>Сценарный диапазон</span><strong>${money(result.low)} – ${money(result.high)}</strong></div>`;
  const f=result.factors;
  $('estimate-date-notes').textContent=`Коэффициенты: площадка — день ${number(f.venueDay)}%, сезон ${number(f.venueSeason)}%, популярная дата ${number(f.specialVenue)}%; команда — день ${number(f.teamDay)}%, сезон ${number(f.teamSeason)}%, популярная дата ${number(f.specialTeam)}%. Индексация: ${number(state.futureAdjustment)}%. Учитываются только у выбранных услуг соответствующего типа. Суммарная поправка даты в строках: ${money(result.dateAddition)}.`;
  $('estimate-sources').innerHTML=`<h3>Источники для ${escape(result.city.name)}</h3><p>${escape(result.city.sourceNote)}</p><div class="source-links">${result.city.sources.map(sourceMarkup).join('')}</div>`;
}

function currentSearches(){return supplierSearches({city:state.city,scope:$('matching-scope').value,type:$('matching-service').value,state});}
function selectedLiveSearch(){return currentSearches().find(q=>q.kind===$('live-kind').value);}
function closeLiveMap(message='Карта закрыта. Повторное открытие потребует вашего нажатия.'){
  clearTimeout(liveMapTimer);$('live-widget').replaceChildren();$('live-widget').hidden=true;$('live-widget').removeAttribute('aria-busy');
  $('close-live-map').hidden=true;$('load-live-map').hidden=false;$('load-live-map').textContent='Разрешить и открыть карту';$('live-consent').hidden=false;$('live-map-status').textContent=message;
}
function renderLiveChoice(){
  const query=selectedLiveSearch();
  $('live-query').textContent=query?query.text:'Сначала выберите услуги в калькуляторе.';$('load-live-map').disabled=!query;
  $('live-search-links').innerHTML=query?`${external(query.yandex,'Открыть Яндекс Карты')}${external(query.dgis,'Искать в 2ГИС')}${external(query.avito,'Искать на Авито')}`:'';
}
function renderLiveSearch(){
  const queries=currentSearches(),key=JSON.stringify(queries.map(q=>q.text));
  if(key===liveSearchKey)return;liveSearchKey=key;closeLiveMap('');
  $('live-kind').replaceChildren(...queries.map(q=>new Option(q.label,q.kind)));
  $('live-kind-field').hidden=queries.length<=1;renderLiveChoice();
}
function loadLiveMap(){
  const query=selectedLiveSearch();if(!query||$('live-widget').querySelector('iframe'))return;
  const frame=document.createElement('iframe');
  frame.title='Яндекс Карты: '+query.text;frame.referrerPolicy='no-referrer';
  frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('allow',"geolocation 'none'; camera 'none'; microphone 'none'; payment 'none'");
  const host=$('live-widget');host.hidden=false;host.setAttribute('aria-busy','true');
  $('load-live-map').hidden=true;$('close-live-map').hidden=false;$('live-consent').hidden=true;$('live-map-status').textContent='Загружаем карту. Если она недоступна, откройте поиск в отдельной вкладке ниже.';
  frame.addEventListener('load',()=>{if(!frame.isConnected)return;clearTimeout(liveMapTimer);host.removeAttribute('aria-busy');$('live-map-status').textContent='Результаты показывает Яндекс. Если виджет пуст или просит проверку, откройте поиск в отдельной вкладке ниже.';});
  frame.addEventListener('error',()=>{if(!frame.isConnected)return;closeLiveMap('Не удалось загрузить карту. Можно повторить попытку или открыть поиск в отдельной вкладке.');});
  liveMapTimer=setTimeout(()=>{if(!frame.isConnected)return;closeLiveMap('Карта не ответила вовремя. Можно повторить попытку или открыть поиск в отдельной вкладке.');},25000);
  frame.src=query.widget;host.append(frame);$('close-live-map').focus({preventScroll:true});
}
function supplierRatingMarkup(source){
  const value=source.rating===null?`<span class="supplier-unrated">${source.reviewScores?'Отзывы с оценками':'Без числового рейтинга'}</span>`:`<strong>${escape(ratingLabel(source).replace(' из 5',''))}</strong><span aria-label="из пяти">/ 5</span>`;
  const scores=source.reviewScores?`<span class="supplier-review-scores">${escape(reviewScoreLabel(source))}</span>`:'';
  return `<div class="supplier-rating-source"><span class="supplier-platform">${escape(PLATFORMS[source.platform])}</span><div class="supplier-rating">${value}</div><span class="supplier-rating-count">${escape(countLabel(source))}</span><span class="supplier-rating-date">Сверено ${escape(prettyDate(source.checkedAt))}</span>${scores}${external(source.url,source.countType==='reviews'?'Профиль и отзывы':'Карточка и отзывы','secondary-button')}</div>`;
}
function renderMatching(){
  renderLiveSearch();
  $('matching-city').textContent=result.city.name;$('matching-region').textContent=result.city.region;
  const type=$('matching-service').value, scope=$('matching-scope').value, place=scope==='region'?result.city.region:result.city.name;
  const platform=$('matching-platform').value,sort=$('matching-sort');
  const ratingInput=$('matching-min-rating'),minRating=ratingInput.value===''?0:Number(ratingInput.value);
  if(ratingInput.validity.badInput||!Number.isFinite(minRating)||minRating<0||minRating>5||ratingInput.validity.stepMismatch){ratingInput.setAttribute('aria-invalid','true');$('matching-rating-error').textContent='Введите рейтинг от 0 до 5, до двух знаков после запятой.';$('matching-rating-error').hidden=false;$('matching-count').textContent='Укажите допустимый порог рейтинга.';$('matching-results').innerHTML='<div class="empty-state matching-empty"><h3>Проверьте рейтинг</h3><p>Введите число от 0 до 5 или очистите поле, чтобы показать все оценки.</p><button type="button" class="secondary-button" data-matching-reset>Сбросить фильтры</button></div>';$('matching-search-links').replaceChildren();return;}
  ratingInput.removeAttribute('aria-invalid');$('matching-rating-error').hidden=true;
  sort.querySelector('option[value=rating]').disabled=platform==='all';
  if(platform==='all'&&sort.value==='rating')sort.value='name';
  const providers=matchSuppliers({city:state.city,type,scope,platform,sort:sort.value,ratedOnly:$('matching-rated').checked,minRating,state});
  const inPlace=matchSuppliers({city:state.city,scope});
  $('matching-count').textContent=`Показано ${number(providers.length)} из ${number(inPlace.length)} карточек · ${place}`;
  $('matching-coverage').textContent=`Каталог: ${SUPPLIERS.length} конкретных площадок и подрядчиков в ${new Set(SUPPLIERS.map(p=>p.city).filter(Boolean)).size} городах и за городом. Сверка источников: ${prettyDate(SUPPLIER_CHECKED_AT)}.`;
  let html=providers.map(provider=>{
    const city=CITIES.find(c=>c.id===provider.city);
    const website=SUPPLIER_WEBSITES[provider.id];
    return `<article class="supplier-card supplier-profile" data-supplier="${provider.id}"><div class="supplier-profile-main"><span class="supplier-category">${escape(provider.kinds.map(k=>SUPPLIER_TYPES[k]).join(' · '))}</span><h3>${escape(provider.name)}</h3><p class="supplier-address">${icon('map-pin')}${escape(city?.name||provider.locality)} · ${escape(provider.address)}</p><p>${escape(provider.description)}</p>${website?`<div class="supplier-profile-links">${external(website.url,'Сайт','secondary-button')}</div>`:'<p class="supplier-website-missing">Отдельный сайт не подтверждён. Откройте профиль и отзывы.</p>'}${provider.note?`<p class="supplier-source-note">${escape(provider.note)}</p>`:''}</div><div class="supplier-rating-panel">${provider.sources.map(supplierRatingMarkup).join('')}</div></article>`;
  }).join('');
  if(!providers.length){
    const hasSelection=type!=='other'||selectedSupplierTypes(state).length>0;
    html=`<div class="empty-state matching-empty"><h3>${hasSelection?'Нет карточек с такими условиями':'Выберите услуги в калькуляторе'}</h3><p>${hasSelection?'Каталог пока не охватывает все услуги в каждом городе. Можно убрать фильтры, посмотреть другие категории или открыть поиск ниже.':'Подбор по смете появится после выбора услуг.'}</p><button type="button" class="secondary-button" data-matching-reset>Все карточки в ${escape(result.city.name)}</button></div>`;
  }
  if(type==='other'){
    const missing=unmappedServices(state);
    if(missing.length)html+=`<p class="matching-missing">Для этих расходов отдельные карточки пока не подобраны: ${escape(missing.map(s=>s.name).join(', '))}.</p>`;
  }
  $('matching-results').innerHTML=html;
  $('matching-search-links').innerHTML=currentSearches().map(query=>`<div class="supplier-search-row"><strong>${escape(query.label)}</strong><div>${external(query.yandex,'Яндекс Карты')}${external(query.dgis,'2ГИС')}${external(query.avito,'Авито')}</div></div>`).join('');
}

function update({services=true,core=false}={}){
  state=sanitizeState(state);result=calculate(state);if(core)syncCore();else syncRadios();
  renderBudget();if(services)renderServices();renderCustom();renderEstimate();renderMatching();persist();syncExportValidity();
}
function setTab(tab,focus=false){
  if(!['calculator','estimate','matching'].includes(tab))return;
  if(tab!=='matching'&&$('live-widget').querySelector('iframe'))closeLiveMap('');
  currentTab=tab;document.querySelectorAll('[data-tab]').forEach(b=>{const selected=b.dataset.tab===tab;b.setAttribute('aria-selected',String(selected));b.tabIndex=selected?0:-1;});
  ['calculator','estimate','matching'].forEach(t=>$('panel-'+t).hidden=t!==tab);
  if(focus){$('tab-'+tab).focus({preventScroll:true});$('tab-'+tab).scrollIntoView({block:'start',behavior:'instant'});}
}
function invalidInputs(){return [...document.querySelectorAll('[aria-invalid=true]')].filter(n=>!n.closest('dialog') && !['custom-name','custom-amount','matching-min-rating'].includes(n.id));}
function syncExportValidity(){const invalid=invalidInputs().length>0;['download-csv','print-estimate','open-estimate','mobile-estimate'].forEach(id=>$(id).disabled=invalid);}
function validateNumeric(input,min,max,integer=true,errorId){
  const n=Number(input.value), valid=input.value!=='' && Number.isFinite(n)&&n>=min&&n<=max&&(!integer||Number.isInteger(n));
  input.setAttribute('aria-invalid',String(!valid));
  if(errorId){const error=$(errorId);error.hidden=valid;error.textContent=valid?'':`Введите ${integer?'целое ':''}число от ${number(min)} до ${number(max)}.`;}
  syncExportValidity();return valid?n:null;
}

function feedbackPayload(){
  const input=$('feedback-text'),text=input.value.trim(),valid=text.length>=10&&text.length<=2000;
  input.setAttribute('aria-invalid',String(!valid));$('feedback-error').hidden=valid;
  if(!valid){$('feedback-error').textContent='Напишите от 10 до 2000 символов.';input.focus();return null;}
  return {type:$('feedback-type').value,rating:Number(document.querySelector('input[name=rating]:checked')?.value)||null,text};
}
function downloadFeedback(payload){
  const text=`Отзыв о калькуляторе свадьбы\nДата: ${new Date().toISOString()}\nТип: ${payload.type==='idea'?'Предложение':'Отзыв'}\nОценка: ${payload.rating??'не указана'}\n\n${payload.text}\n`;
  const url=URL.createObjectURL(new Blob(['\ufeff'+text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
  a.href=url;a.download='отзыв-калькулятор-свадьбы.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function feedbackSuccess(saved){
  $('dialog-content').innerHTML=`<div class="feedback-success"><h3>${saved?'Спасибо за обратную связь':'Файл отзыва скачан'}</h3><p>${saved?'Отзыв сохранён в файле локального проекта.':'Файл находится в загрузках браузера. Он не отправлен владельцу сайта.'}</p><button type="button" class="secondary-button" id="feedback-done">Вернуться к расчёту</button></div>`;
  $('feedback-done').addEventListener('click',()=>$('info-dialog').close());$('feedback-done').focus();
}

function showDialog(kind){
  const dialog=$('info-dialog'),content=$('dialog-content');
  if(kind==='method'){
    $('dialog-title').textContent='Откуда берутся цены';
    content.innerHTML=`<p>Цены проверены 8 октября 2026 года. Выбранный город: <strong>${escape(result.city.name)}</strong>. Ставки — ориентиры для планирования по открытым предложениям и редакционной модели, а не статистические средние по всему рынку.</p><h3>Что подтверждено источниками</h3><p>${escape(result.city.sourceNote)}</p><div class="source-links">${result.city.sources.map(sourceMarkup).join('')}</div><h3>Как устроен расчёт</h3><ul><li>У каждого города собственные ставки меню, аренды, ведущего, фото, видео, декора и других услуг. Это разные ориентиры, а не один общий коэффициент города.</li><li>Базовый уровень — «Комфорт». «Эконом» и «Премиум» меняют ставки по отдельным группам. Формат меняет рекомендуемое число гостей.</li><li>Надбавки дня недели и сезона суммируются относительно базовой цены. Применяются только к аренде и отмеченным услугам команды; меню и кольца не дорожают просто из-за субботы.</li><li>Коэффициенты — настраиваемые допущения. Это не тариф конкретного подрядчика. Праздники учитываются по фиксированным датам ТК РФ; переносы выходных и местные праздники не определяются автоматически.</li><li>Цены будущих лет автоматически не прогнозируются. Используйте поле поправки на будущие цены.</li><li>Сценарный диапазон −20% / +25% меняет модельные цены. Для кухни учитывается минимальный заказ; затем пересчитываются сервис, организация и резерв. Это не статистический интервал.</li><li>Свои цены считаются окончательными. Введите полную цену единицы услуги на выбранную дату.</li></ul><h3>Защита от двойного счёта</h3><p>Отключайте всё, что уже включено в пакет. Ведущий, DJ и банкетная техника у нас разделены. Декор столов, арка церемонии и фотозона — разные позиции. Проживание, наряды, кольца и алкоголь учитываются только при выборе.</p><p>Смета — справочный расчёт, не публичная оферта (ст. 437 ГК РФ). Итог, НДС и другие применимые платежи уточняются у исполнителя до заключения договора.</p>`;
  }else if(kind==='feedback'){
    $('dialog-title').textContent='Ваш отзыв или идея';
    content.innerHTML=`<p>Что понравилось, чего не хватило или что стоит исправить? Отзыв без имени и контактов.</p><form id="feedback-form" class="feedback-form" novalidate><div class="field"><label for="feedback-type">Хочу</label><select id="feedback-type"><option value="review">Оставить отзыв</option><option value="idea">Предложить улучшение</option></select></div><fieldset class="rating-field"><legend>Ваша оценка · необязательно</legend><div class="rating-options">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="rating" value="${n}"><span>${n}</span></label>`).join('')}</div><p class="field-hint">1 — многое стоит улучшить, 5 — всё понравилось.</p></fieldset><div class="field"><label for="feedback-text">Расскажите подробнее</label><textarea id="feedback-text" rows="5" minlength="10" maxlength="2000" aria-describedby="feedback-hint feedback-error" placeholder="Например, добавить сравнение двух вариантов свадьбы…"></textarea><span class="field-hint" id="feedback-count">0 / 2000</span></div><p class="field-hint" id="feedback-hint">${localFeedback?'После нажатия отзыв сохранится в файле локального проекта. Параметры вашей свадьбы не отправляются.':'Эта версия работает на статическом хостинге. Кнопка скачает файл отзыва на ваше устройство; автоматической отправки владельцу нет.'} Не указывайте имена, телефоны, почту или другие персональные данные.</p><p class="field-error" id="feedback-error" role="alert" hidden></p><div class="dialog-actions"><button type="submit" class="primary-button" id="send-feedback">${localFeedback?'Сохранить отзыв':'Скачать отзыв'}</button><button type="button" class="secondary-button" id="download-feedback" ${localFeedback?'':'hidden'}>Скачать копию</button></div></form>`;
  }else if(kind==='privacy'){
    $('dialog-title').textContent='Политика данных';
    content.innerHTML=`<p>Версия от 8 октября 2026 года. Калькулятор не запрашивает имя, телефон, почту, точное место проживания или платёжные данные. Все расчёты выполняются в вашем браузере.</p><h3>Что обрабатывается</h3><p>Выбранный город, дата, число гостей, услуги, цены и свои расходы обрабатываются на устройстве. Сам расчёт не отправляется на сервер. При открытии внешнего поиска передаются услуга и город / регион, как описано ниже. Не указывайте персональные данные в названии своего расхода.</p><h3>Cookies, аналитика и локальное хранение</h3><p>Сам калькулятор не устанавливает cookies, не использует рекламные пиксели, аналитику и удалённые шрифты. Карта Яндекса — необязательный внешний виджет с собственными cookies; до отдельного разрешения она не загружается. Технический выбор «сохранять / не сохранять» записывается в localStorage браузера на 90 дней после вашего действия. Смета сохраняется там же только с вашим разрешением, до окончания этого срока.</p><p>Вы можете отказаться и пользоваться всеми функциями. Отозвать разрешение и удалить сохранённую смету можно в «Настройках хранения». При отказе текущий расчёт остаётся только в памяти открытой вкладки. Автоматическое удаление истёкших записей происходит при следующем открытии сайта; также можно очистить данные сайта в браузере.</p><h3>Необязательная карта Яндекса</h3><p>Во вкладке «Подбор» можно отдельно разрешить загрузку виджета Яндекс Карт. Яндекс и подключённые им сервисы могут получать IP-адрес и технические данные браузера, использовать cookies и показывать рекламу. В запрос передаются только вид услуги и выбранные город / регион. Дата свадьбы, число гостей, бюджет и текст отзыва не передаются. Виджет работает по <a href="https://yandex.ru/legal/confidential/" target="_blank" rel="noopener noreferrer">политике Яндекса</a>.</p><p>Разрешение не сохраняется. Карта отключается при закрытии виджета, уходе из «Подбора» или смене поискового запроса. Для повторной загрузки нужно снова нажать кнопку. Закрытие карты не удаляет уже установленные внешним сервисом cookies; их можно очистить в настройках браузера. Каталог и расчёт доступны без карты.</p><h3>Скачивание и внешние сайты</h3><p>Смета формируется на устройстве. CSV и PDF, которые вы сохранили, находятся под вашим контролем. При переходе в «Подборе» вы открываете внешний сайт с его собственной политикой. В поисковую ссылку передаются только вид услуги и выбранные город / регион; дата, гости и суммы не передаются.</p><h3>После размещения в интернете</h3><p>Сервер и хостинг могут получать IP-адрес и технические сведения о запросах. Эта локальная версия не описывает будущие серверные журналы. До публичного запуска владелец должен дополнить политику своими реквизитами, контактом для обращений, условиями хостинга и фактическим перечнем обработки.</p><p>Правовая основа для подготовки политики: 152-ФЗ, в том числе статьи 9, 18, 18.1, 19 и 22. Разрешение на сохранение расчёта в браузере не заменяет согласие на будущую серверную обработку персональных данных.</p><div class="source-links">${LEGAL_SOURCES.map(s=>`<div class="source-item">${external(s.url,s.title)}</div>`).join('')}</div><div class="dialog-actions"><button class="secondary-button" type="button" data-dialog="storage">Настройки хранения</button></div>`;
  }else if(kind==='storage'){
    $('dialog-title').textContent='Настройки хранения';
    content.innerHTML=`<p>Cookies и аналитика отключены: калькулятор работает без них. Единственная дополнительная возможность — помнить вашу смету на этом устройстве.</p><div class="storage-option"><label for="dialog-storage"><input type="checkbox" id="dialog-storage" ${storageAllowed?'checked':''} ${!storageAvailable?'disabled':''}><span>Сохранять расчёт в этом браузере</span></label><p>Город, дата, гости, услуги и ваши цены. Срок — 90 дней после выбора. Данные не передаются нам.</p></div><p>При выключении сохранённая смета удаляется. Текущий расчёт остаётся в открытой вкладке. Ваш выбор хранится 90 дней, чтобы не спрашивать при каждом открытии.</p><div class="dialog-actions"><button class="primary-button" type="button" id="save-storage-settings">Сохранить выбор</button><button class="secondary-button" type="button" id="delete-local-data">Удалить данные</button></div>`;
  }else if(kind==='date'){
    $('dialog-title').textContent='Поправки к выбранной дате';
    const fields=[['venueDay','Площадка: день недели'],['venueSeason','Площадка: сезон'],['teamDay','Команда: день недели'],['teamSeason','Команда: сезон'],['specialVenue','Площадка: популярная дата'],['specialTeam','Команда: популярная дата']];
    content.innerHTML=`<p>${escape(result.city.name)} · ${escape(prettyDate(state.date))}. Это допущения для планирования. При известной цене площадки укажите её в самой услуге — без повторных надбавок.</p><div class="date-factor-grid">${fields.map(([key,title])=>`<div class="field"><label for="factor-${key}">${title}, %</label><input id="factor-${key}" data-factor="${key}" type="number" min="-50" max="100" value="${result.factors[key]}" step="1" aria-describedby="factor-error"></div>`).join('')}</div><p class="field-error" id="factor-error" hidden></p><p>Проценты суммируются от базовой ставки. Например, +25% за субботу и +18% за сезон = +43% к аренде. На питание поправки даты не влияют.</p><p>При смене города или даты вернутся предложенные коэффициенты. Региональные праздники и переносы выходных можно учесть вручную.</p><div class="dialog-actions"><button class="primary-button" type="button" id="save-date-factors">Применить</button><button class="secondary-button" type="button" id="reset-date-factors">Вернуть ориентиры</button></div>`;
  }
  if(kind==='privacy')content.insertAdjacentHTML('beforeend',`<h3>Отзывы и предложения</h3><p>${localFeedback?'Только при нажатии «Сохранить отзыв» текст, тип сообщения, необязательная оценка и время сохранения отправляются на локальный сервер 127.0.0.1. Они записываются в закрытый файл data/feedback.jsonl проекта. Имя, контакты и параметры свадьбы не запрашиваются и не добавляются. Владелец локального проекта может прочитать или удалить файл; автоматического срока удаления нет.':'На статическом хостинге отзыв скачивается в текстовый файл на вашем устройстве. Приложение не отправляет его владельцу и не передаёт текст хостингу.'} Не вписывайте персональные данные в свободный текст.</p>`);
  if(kind==='privacy'){
    content.innerHTML=content.innerHTML.replace('Эта локальная версия не описывает будущие серверные журналы.','Состав и сроки журналов определяются хостингом.');
    content.insertAdjacentHTML('beforeend',`<h3>GitHub Pages — планируемое размещение</h3><p>GitHub сообщает, что записывает и хранит IP-адреса посетителей для безопасности. Обработка инфраструктурой хостинга существует даже при отсутствии аналитики в калькуляторе. ${external('https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection','Сведения GitHub о сборе данных')}. До публикации владелец должен определить применимые обязанности по законодательству РФ и добавить свой контакт для обращений.</p>`);
  }
  if(!dialog.open)dialog.showModal();
  const first=content.querySelector('input:not(:disabled),button,a');(first||$('dialog-close')).focus({preventScroll:true});
}

loadStorage();populateCore();hydrateIcons();update();$('storage-banner').hidden=preference!==null;

document.addEventListener('click',e=>{
  const target=e.target.closest('button');if(!target)return;
  if(target.dataset.tab)setTab(target.dataset.tab);
  if(target.dataset.dialog)showDialog(target.dataset.dialog);
  if(target.dataset.goCalculator!==undefined)setTab('calculator',true);
  if(target.dataset.category){category=target.dataset.category;document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category===category)));renderServices();}
  if(target.dataset.step){const [key,delta]=target.dataset.step.split(':');state[key]=Math.min(key==='adults'?500:150,Math.max(key==='adults'?2:0,state[key]+Number(delta)));state.format='custom';$(key).value=state[key];$(key).removeAttribute('aria-invalid');$('guest-error').hidden=true;update();}
  if(target.dataset.resetService){const id=target.dataset.resetService;delete state.overrides[id];delete state.quantities[id];update();}
  if(target.dataset.deleteCustom!==undefined){const index=Number(target.dataset.deleteCustom);const removed=state.custom.splice(index,1)[0];update();notify('Расход удалён.',()=>{state.custom.splice(index,0,removed);update();});}
});
document.querySelector('.workspace-tabs').addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
  const tabs=[...document.querySelectorAll('[data-tab]')],index=tabs.findIndex(t=>t===document.activeElement);
  const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  setTab(tabs[next].dataset.tab);tabs[next].focus({preventScroll:true});
});
$('region').addEventListener('change',()=>{state.city=CITIES.find(c=>c.region===$('region').value).id;state.dateOverrides={};syncCities();update();});
$('city').addEventListener('change',()=>{state.city=$('city').value;state.dateOverrides={};update();});
$('wedding-date').addEventListener('change',()=>{const value=$('wedding-date').value;if(value&&!parseDate(value)){$('wedding-date').setAttribute('aria-invalid','true');$('date-hint').textContent='Выберите корректную дату с 2020 по 2040 год.';syncExportValidity();return;}$('wedding-date').removeAttribute('aria-invalid');state.date=value;state.dateOverrides={};update();});
for(const key of ['adults','children'])$(key).addEventListener('change',()=>{const n=validateNumeric($(key),key==='adults'?2:0,key==='adults'?500:150,true,'guest-error');if(n===null)return;state[key]=n;state.format='custom';update();});
$('format-options').addEventListener('change',e=>{state.format=e.target.value;state.adults=FORMATS.find(f=>f.id===state.format).guests;state.children=0;$('adults').value=state.adults;$('children').value=0;['adults','children'].forEach(id=>$(id).removeAttribute('aria-invalid'));$('guest-error').hidden=true;update();});
$('tier-options').addEventListener('change',e=>{state.tier=e.target.value;update();});
$('venue-type').addEventListener('change',()=>{state.venueType=$('venue-type').value;update();});
for(const [id,serviceId] of [['adult-menu-price','meal'],['child-menu-price','kidsMeal']])$(id).addEventListener('change',()=>{
  const n=validateNumeric($(id),0,1000000,false,'menu-price-error');
  if(n===null)return;
  state.overrides[serviceId]=n;
  if(['adult-menu-price','child-menu-price'].some(id=>$(id).getAttribute('aria-invalid')==='true')){$('menu-price-error').hidden=false;$('menu-price-error').textContent='Укажите для обоих меню цену от 0 до 1 000 000 ₽.';}
  update();
});
$('reset-menu-price').addEventListener('click',()=>{for(const id of ['meal','kidsMeal']){delete state.overrides[id];delete state.quantities[id];}for(const id of ['adult-menu-price','child-menu-price'])$(id).removeAttribute('aria-invalid');$('menu-price-error').hidden=true;update();});
for(const [id,key,max] of [['service-fee','serviceFee',30],['minimum-food','minFood',5000000],['future-adjustment','futureAdjustment',100],['organizer-fee','organizerFee',30]]){
  $(id).addEventListener('change',()=>{const input=$(id),n=validateNumeric(input,0,max,false);let hint=input.parentElement.querySelector('.input-validation');if(n===null){if(!hint){hint=document.createElement('span');hint.className='field-error input-validation';hint.id=id+'-error';input.setAttribute('aria-describedby',hint.id);input.parentElement.append(hint);}hint.textContent=`Введите число от 0 до ${number(max)}.`;return;}hint?.remove();input.removeAttribute('aria-describedby');state[key]=n;update();});
}
$('special-date').addEventListener('change',()=>{state.specialDate=$('special-date').checked;state.dateOverrides={};update();});
$('organizer').addEventListener('change',()=>{state.organizer=$('organizer').checked;$('organizer-fee').disabled=!state.organizer;$('organizer-fee').removeAttribute('aria-invalid');update();});
$('reserve').addEventListener('change',()=>{state.reserve=Number($('reserve').value);update({services:false});});
$('service-search').addEventListener('input',()=>{search=$('service-search').value.trim();renderServices();});
$('selected-only').addEventListener('change',()=>{selectedOnly=$('selected-only').checked;renderServices();});
$('clear-filters').addEventListener('click',()=>{category='all';search='';selectedOnly=false;$('service-search').value='';$('selected-only').checked=false;document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category==='all')));renderServices();$('service-search').focus();});
$('services-list').addEventListener('change',e=>{
  const input=e.target;
  if(input.dataset.selectService){const id=input.dataset.selectService;state.selected=input.checked?[...new Set([...state.selected,id])]:state.selected.filter(x=>x!==id);update();}
  if(input.dataset.price){const id=input.dataset.price;if(input.value===''){delete state.overrides[id];update();return;}const n=validateNumeric(input,0,1000000,false,'edit-error-'+id);if(n===null)return;state.overrides[id]=n;update();}
  if(input.dataset.quantity){const id=input.dataset.quantity,service=SERVICES.find(s=>s.id===id);const n=validateNumeric(input,0,10000,service.unit!=='кг','edit-error-'+id);if(n===null)return;state.quantities[id]=n;update();}
});
$('custom-form').addEventListener('submit',e=>{e.preventDefault();const name=$('custom-name').value.trim();const amount=validateNumeric($('custom-amount'),0,5000000,true,'custom-error');if(!name){$('custom-name').setAttribute('aria-invalid','true');$('custom-error').hidden=false;$('custom-error').textContent='Укажите название расхода.';$('custom-name').focus();return;}if(amount===null)return;if(state.custom.length>=30){$('custom-error').hidden=false;$('custom-error').textContent='Можно добавить до 30 своих расходов.';return;}state.custom.push({id:'custom-'+Date.now(),name,amount});$('custom-name').removeAttribute('aria-invalid');$('custom-amount').removeAttribute('aria-invalid');$('custom-form').reset();$('custom-error').hidden=true;update();$('custom-name').focus();});
$('open-estimate').addEventListener('click',()=>setTab('estimate',true));$('mobile-estimate').addEventListener('click',()=>setTab('estimate',true));$('open-matching').addEventListener('click',()=>setTab('matching',true));
$('change-matching-city').addEventListener('click',()=>{setTab('calculator',true);$('region').focus();});
['matching-service','matching-scope','matching-platform','matching-sort','matching-rated','matching-min-rating'].forEach(id=>$(id).addEventListener('change',renderMatching));
$('load-live-map').addEventListener('click',loadLiveMap);
$('close-live-map').addEventListener('click',()=>{closeLiveMap();$('load-live-map').focus({preventScroll:true});});
$('live-kind').addEventListener('change',()=>{closeLiveMap('');renderLiveChoice();});
$('live-search').addEventListener('toggle',()=>{if(!$('live-search').open&&$('live-widget').querySelector('iframe'))closeLiveMap('');});
$('matching-results').addEventListener('click',event=>{if(!event.target.closest('[data-matching-reset]'))return;$('matching-service').value='all';$('matching-scope').value='city';$('matching-platform').value='all';$('matching-sort').value='name';$('matching-rated').checked=false;$('matching-min-rating').value='';renderMatching();$('matching-service').focus();});
$('download-csv').addEventListener('click',()=>{if(invalidInputs().length)return;try{const blob=new Blob([exportCsv(result)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`смета-свадьбы-${result.city.id}-${state.date||'без-даты'}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Смета отправлена в загрузки браузера.');}catch{notify('Не удалось скачать смету. Попробуйте сохранить её через печать.');}});
$('print-estimate').addEventListener('click',()=>{if(!invalidInputs().length){setTab('estimate');window.print();}});
window.addEventListener('beforeprint',renderEstimate);
$('reset-calculation').addEventListener('click',()=>{previousState=structuredClone(state);state=createState();category='all';search='';selectedOnly=false;$('service-search').value='';$('selected-only').checked=false;document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.category==='all')));update({core:true});notify('Расчёт сброшен.',()=>{state=previousState;update({core:true});});});
$('storage-accept').addEventListener('click',()=>chooseStorage(true));$('storage-decline').addEventListener('click',()=>chooseStorage(false));
$('dialog-close').addEventListener('click',()=>$('info-dialog').close());
$('info-dialog').addEventListener('click',e=>{if(e.target===$('info-dialog')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('dialog-content').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;
  if(b.id==='download-feedback'){const payload=feedbackPayload();if(payload){downloadFeedback(payload);notify('Копия отзыва скачана.');}}
  if(b.id==='save-storage-settings'){chooseStorage($('dialog-storage').checked);$('info-dialog').close();}
  if(b.id==='delete-local-data'){try{localStorage.removeItem(PREF_KEY);localStorage.removeItem(STATE_KEY);}catch{/* No storage to delete. */}storageAllowed=false;preference=null;$('info-dialog').close();$('storage-banner').hidden=false;notify('Сохранённые данные удалены. Текущий расчёт остался в этой вкладке.');}
  if(b.id==='save-date-factors'){const inputs=[...document.querySelectorAll('[data-factor]')];const values=inputs.map(input=>[input.dataset.factor,validateNumeric(input,-50,100,false,'factor-error')]);if(values.some(([,n])=>n===null)){$('factor-error').hidden=false;$('factor-error').textContent='Все поправки должны быть числами от −50 до 100%.';return;}state.dateOverrides=Object.fromEntries(values);update();$('info-dialog').close();}
  if(b.id==='reset-date-factors'){state.dateOverrides={};update();showDialog('date');}
});
$('dialog-content').addEventListener('input',e=>{if(e.target.id==='feedback-text')$('feedback-count').textContent=`${e.target.value.length} / 2000`;});
$('dialog-content').addEventListener('submit',async e=>{
  if(e.target.id!=='feedback-form')return;e.preventDefault();
  const form=e.target,payload=feedbackPayload();if(!payload)return;
  const button=$('send-feedback');if(button.disabled)return;
  if(!localFeedback){downloadFeedback(payload);feedbackSuccess(false);return;}
  button.disabled=true;button.textContent='Сохраняем…';form.setAttribute('aria-busy','true');
  try{
    const response=await fetch('./api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(10000)});
    const reply=await response.json();
    if(response.status!==201||reply.ok!==true)throw new Error([400,413,429,503].includes(response.status)&&typeof reply.error==='string'?reply.error:'Сервер не подтвердил сохранение.');
    if(form.isConnected)feedbackSuccess(true);
  }catch(err){if(form.isConnected){$('feedback-error').hidden=false;$('feedback-error').textContent=err.name==='TimeoutError'?'Нет ответа сервера. Сохранение не подтверждено. Скачайте копию отзыва.':`${err.message} Можно скачать копию отзыва.`;}}
  finally{if(form.isConnected){button.disabled=false;button.textContent='Сохранить отзыв';form.removeAttribute('aria-busy');}}
});
window.addEventListener('storage',e=>{if(e.key===PREF_KEY||e.key===null){try{const pref=JSON.parse(localStorage.getItem(PREF_KEY)||'null');if(!pref||pref.allowed!==true||pref.expires<=Date.now()){storageAllowed=false;preference=pref;}}catch{storageAllowed=false;}}});
