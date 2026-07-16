import { getRuntimeLocale } from '../i18n/translate';
import type { Locale } from '../i18n/types';

export type CityOption = {
  label: string;
  value: string;
};

function cities(...entries: [label: string, value: string][]): CityOption[] {
  return entries.map(([label, value]) => ({ label, value }));
}

export const CITIES_BY_COUNTRY: Record<string, CityOption[]> = {
  HU: cities(
    ['Будапешт', 'Budapest'],
    ['Дебрецен', 'Debrecen'],
    ['Сегед', 'Szeged'],
    ['Печ', 'Pécs'],
    ['Дьёр', 'Győr'],
  ),
  PL: cities(
    ['Варшава', 'Warsaw'],
    ['Краков', 'Kraków'],
    ['Гданьск', 'Gdańsk'],
    ['Вроцлав', 'Wrocław'],
  ),
  DE: cities(
    ['Берлин', 'Berlin'],
    ['Гамбург', 'Hamburg'],
    ['Мюнхен', 'Munich'],
    ['Кёльн', 'Cologne'],
    ['Франкфурт-на-Майне', 'Frankfurt'],
    ['Штутгарт', 'Stuttgart'],
    ['Дюссельдорф', 'Düsseldorf'],
    ['Лейпциг', 'Leipzig'],
    ['Дортмунд', 'Dortmund'],
    ['Нюрнберг', 'Nuremberg'],
    ['Бремен', 'Bremen'],
    ['Ганновер', 'Hanover'],
    ['Дрезден', 'Dresden'],
    ['Эссен', 'Essen'],
    ['Дуйсбург', 'Duisburg'],
  ),
  NL: cities(
    ['Амстердам', 'Amsterdam'],
    ['Роттердам', 'Rotterdam'],
    ['Гаага', 'The Hague'],
    ['Утрехт', 'Utrecht'],
    ['Эйндховен', 'Eindhoven'],
    ['Тилбург', 'Tilburg'],
    ['Бреда', 'Breda'],
    ['Неймеген', 'Nijmegen'],
    ['Арнем', 'Arnhem'],
    ['Алмере', 'Almere'],
    ['Гронинген', 'Groningen'],
    ['Энсхеде', 'Enschede'],
    ['Венло', 'Venlo'],
    ['Маастрихт', 'Maastricht'],
    ['Лейден', 'Leiden'],
    ['Хофддорп', 'Hoofddorp'],
  ),
  SK: cities(
    ['Братислава', 'Bratislava'],
    ['Кошице', 'Košice'],
    ['Жилина', 'Žilina'],
    ['Нитра', 'Nitra'],
    ['Трнава', 'Trnava'],
    ['Тренчин', 'Trenčín'],
    ['Банска-Бистрица', 'Banská Bystrica'],
    ['Прешов', 'Prešov'],
    ['Попрад', 'Poprad'],
    ['Мартин', 'Martin'],
    ['Нове-Замки', 'Nové Zámky'],
    ['Зволен', 'Zvolen'],
    ['Комарно', 'Komárno'],
    ['Левице', 'Levice'],
    ['Михаловце', 'Michalovce'],
  ),
  CZ: cities(
    ['Прага', 'Prague'],
    ['Брно', 'Brno'],
    ['Острава', 'Ostrava'],
    ['Пльзень', 'Plzeň'],
    ['Либерец', 'Liberec'],
    ['Оломоуц', 'Olomouc'],
    ['Ческе-Будеёвице', 'České Budějovice'],
    ['Градец-Кралове', 'Hradec Králové'],
    ['Усти-над-Лабем', 'Ústí nad Labem'],
    ['Пardubice', 'Pardubice'],
    ['Зlin', 'Zlín'],
    ['Карловы Вары', 'Karlovy Vary'],
    ['Млада-Болеслав', 'Mladá Boleslav'],
    ['Опава', 'Opava'],
    ['Фридек-Мистек', 'Frýdek-Místek'],
  ),
  AT: cities(
    ['Вена', 'Vienna'],
    ['Грац', 'Graz'],
    ['Линц', 'Linz'],
    ['Зальцбург', 'Salzburg'],
    ['Инсбрук', 'Innsbruck'],
    ['Кlagenfurt', 'Klagenfurt'],
    ['Филлах', 'Villach'],
    ['Вельс', 'Wels'],
    ['Санкт-Пёльтен', 'Sankt Pölten'],
    ['Винер-Нойштадт', 'Wiener Neustadt'],
    ['Брегенц', 'Bregenz'],
    ['Фельдкирх', 'Feldkirch'],
    ['Швехат (аэропорт Вены)', 'Schwechat'],
    ['Кремс-ан-дер-Донау', 'Krems an der Donau'],
    ['Куфштайн', 'Kufstein'],
  ),
  LT: cities(
    ['Вильнюс', 'Vilnius'],
    ['Каунас', 'Kaunas'],
    ['Клайпеда', 'Klaipėda'],
    ['Шiauliai', 'Šiauliai'],
    ['Пanevėžys', 'Panevėžys'],
    ['Аlitus', 'Alytus'],
    ['Marijampolė', 'Marijampolė'],
    ['Mažeikiai', 'Mažeikiai'],
    ['Jonava', 'Jonava'],
    ['Utena', 'Utena'],
    ['Kėdainiai', 'Kėdainiai'],
    ['Tauragė', 'Tauragė'],
    ['Telšiai', 'Telšiai'],
    ['Palanga', 'Palanga'],
    ['Druskininkai', 'Druskininkai'],
  ),
  LV: cities(
    ['Рига', 'Riga'],
    ['Daugavpils', 'Daugavpils'],
    ['Liepāja', 'Liepāja'],
    ['Jelgava', 'Jelgava'],
    ['Jūrmala', 'Jūrmala'],
    ['Ventspils', 'Ventspils'],
    ['Rēzekne', 'Rēzekne'],
    ['Valmiera', 'Valmiera'],
    ['Jēkabpils', 'Jēkabpils'],
    ['Ogre', 'Ogre'],
    ['Salaspils', 'Salaspils'],
    ['Cēsis', 'Cēsis'],
    ['Tukums', 'Tukums'],
    ['Bauska', 'Bauska'],
    ['Sigulda', 'Sigulda'],
  ),
  EE: cities(
    ['Таллин', 'Tallinn'],
    ['Tartu', 'Tartu'],
    ['Narva', 'Narva'],
    ['Pärnu', 'Pärnu'],
    ['Kohtla-Järve', 'Kohtla-Järve'],
    ['Rakvere', 'Rakvere'],
    ['Viljandi', 'Viljandi'],
    ['Maardu', 'Maardu'],
    ['Sillamäe', 'Sillamäe'],
    ['Jõhvi', 'Jõhvi'],
    ['Keila', 'Keila'],
    ['Paldiski', 'Paldiski'],
    ['Valga', 'Valga'],
    ['Võru', 'Võru'],
    ['Kuressaare', 'Kuressaare'],
  ),
  IT: cities(
    ['Милан', 'Milan'],
    ['Рим', 'Rome'],
    ['Тurin', 'Turin'],
    ['Болонья', 'Bologna'],
    ['Верona', 'Verona'],
    ['Венеция', 'Venice'],
    ['Padua', 'Padua'],
    ['Florence', 'Florence'],
    ['Genoa', 'Genoa'],
    ['Brescia', 'Brescia'],
    ['Parma', 'Parma'],
    ['Modena', 'Modena'],
    ['Naples', 'Naples'],
    ['Bari', 'Bari'],
    ['Trieste', 'Trieste'],
    ['Bergamo', 'Bergamo'],
    ['Reggio Emilia', 'Reggio Emilia'],
    ['Trento', 'Trento'],
    ['Bolzano', 'Bolzano'],
    ['Livorno', 'Livorno'],
  ),
  ES: cities(
    ['Мадрид', 'Madrid'],
    ['Барселона', 'Barcelona'],
    ['Валенсия', 'Valencia'],
    ['Сaragossa', 'Zaragoza'],
    ['Севилья', 'Seville'],
    ['Мálaga', 'Málaga'],
    ['Bilbao', 'Bilbao'],
    ['Murcia', 'Murcia'],
    ['Alicante', 'Alicante'],
    ['Valladolid', 'Valladolid'],
    ['La Coruña', 'A Coruña'],
    ['Vigo', 'Vigo'],
    ['San Sebastián', 'San Sebastián'],
    ['Tarragona', 'Tarragona'],
    ['Girona', 'Girona'],
    ['Granada', 'Granada'],
    ['Córdoba', 'Córdoba'],
    ['Burgos', 'Burgos'],
    ['Pamplona', 'Pamplona'],
    ['Santander', 'Santander'],
  ),
  FR: cities(
    ['Париж', 'Paris'],
    ['Лион', 'Lyon'],
    ['Лille', 'Lille'],
    ['Марсель', 'Marseille'],
    ['Стrasbourg', 'Strasbourg'],
    ['Bordeaux', 'Bordeaux'],
    ['Toulouse', 'Toulouse'],
    ['Nantes', 'Nantes'],
    ['Rennes', 'Rennes'],
    ['Nice', 'Nice'],
    ['Montpellier', 'Montpellier'],
    ['Rouen', 'Rouen'],
    ['Dijon', 'Dijon'],
    ['Le Havre', 'Le Havre'],
    ['Clermont-Ferrand', 'Clermont-Ferrand'],
    ['Reims', 'Reims'],
    ['Grenoble', 'Grenoble'],
    ['Tours', 'Tours'],
    ['Cannes', 'Cannes'],
    ['Perpignan', 'Perpignan'],
  ),
  RO: cities(
    ['Бухарест', 'Bucharest'],
    ['Cluj-Napoca', 'Cluj-Napoca'],
    ['Timișoara', 'Timișoara'],
    ['Constanța', 'Constanța'],
    ['Iași', 'Iași'],
    ['Brașov', 'Brașov'],
    ['Sibiu', 'Sibiu'],
    ['Craiova', 'Craiova'],
    ['Oradea', 'Oradea'],
    ['Arad', 'Arad'],
    ['Ploiești', 'Ploiești'],
    ['Galați', 'Galați'],
    ['Pitești', 'Pitești'],
    ['Bacău', 'Bacău'],
    ['Târgu Mureș', 'Târgu Mureș'],
    ['Satu Mare', 'Satu Mare'],
    ['Suceava', 'Suceava'],
    ['Brăila', 'Brăila'],
    ['Baia Mare', 'Baia Mare'],
    ['Râmnicu Vâlcea', 'Râmnicu Vâlcea'],
  ),
  BE: cities(
    ['Брюссель', 'Brussels'],
    ['Антwerp', 'Antwerp'],
    ['Ghent', 'Ghent'],
    ['Liège', 'Liège'],
    ['Charleroi', 'Charleroi'],
    ['Bruges', 'Bruges'],
    ['Leuven', 'Leuven'],
    ['Namur', 'Namur'],
    ['Mechelen', 'Mechelen'],
    ['Hasselt', 'Hasselt'],
    ['Genk', 'Genk'],
    ['Kortrijk', 'Kortrijk'],
    ['Ostend', 'Ostend'],
    ['Mons', 'Mons'],
    ['Sint-Niklaas', 'Sint-Niklaas'],
  ),
  MD: cities(
    ['Кишинёв', 'Chișinău'],
    ['Bălți', 'Bălți'],
    ['Bender', 'Bender'],
    ['Tiraspol', 'Tiraspol'],
    ['Cahul', 'Cahul'],
    ['Ungheni', 'Ungheni'],
    ['Orhei', 'Orhei'],
    ['Soroca', 'Soroca'],
    ['Comrat', 'Comrat'],
    ['Hîncești', 'Hîncești'],
    ['Edineț', 'Edineț'],
    ['Ceadîr-Lunga', 'Ceadîr-Lunga'],
    ['Căușeni', 'Căușeni'],
    ['Strășeni', 'Strășeni'],
    ['Florești', 'Florești'],
  ),
  UA: cities(
    ['Киев', 'Kyiv'],
    ['Львов', 'Lviv'],
    ['Одесса', 'Odesa'],
    ['Днепр', 'Dnipro'],
    ['Харьков', 'Kharkiv'],
    ['Винница', 'Vinnytsia'],
    ['Жitomir', 'Zhytomyr'],
    ['Rivne', 'Rivne'],
    ['Lutsk', 'Lutsk'],
    ['Ternopil', 'Ternopil'],
    ['Khmelnytskyi', 'Khmelnytskyi'],
    ['Ivano-Frankivsk', 'Ivano-Frankivsk'],
    ['Uzhhorod', 'Uzhhorod'],
    ['Mukachevo', 'Mukachevo'],
    ['Chernivtsi', 'Chernivtsi'],
    ['Poltava', 'Poltava'],
    ['Cherkasy', 'Cherkasy'],
    ['Kropyvnytskyi', 'Kropyvnytskyi'],
    ['Mykolaiv', 'Mykolaiv'],
    ['Kovel', 'Kovel'],
  ),
  GB: cities(
    ['Лондон', 'London'],
    ['Мanchester', 'Manchester'],
  ),
};

export function cityOptionsForCountry(country: string): CityOption[] {
  return CITIES_BY_COUNTRY[country] ?? [];
}

export function citiesForCountry(country: string): string[] {
  return cityOptionsForCountry(country).map((c) => c.value);
}

export function cityLabelForValue(country: string, value: string, locale: Locale = getRuntimeLocale()): string {
  const found = cityOptionsForCountry(country).find(
    (c) => c.value.toLowerCase() === value.trim().toLowerCase(),
  );
  if (!found) return value;
  return locale === 'ru' || locale === 'uk' ? found.label : found.value;
}

export function cityOptionsForDisplay(country: string, locale: Locale = getRuntimeLocale()): CityOption[] {
  return cityOptionsForCountry(country).map((c) => ({
    label: locale === 'ru' || locale === 'uk' ? c.label : c.value,
    value: c.value,
  }));
}

export function defaultCityValueForCountry(country: string): string {
  return cityOptionsForCountry(country)[0]?.value ?? '';
}

function foldCityText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Map OSM / localized city name to canonical catalog value (e.g. «Берлин» → Berlin). */
export function canonicalCityValue(country: string, raw: string): string {
  const q = foldCityText(raw);
  if (!q) return '';
  const options = cityOptionsForCountry(country);
  for (const c of options) {
    const names = [c.value, c.label].map(foldCityText);
    if (names.some((name) => name === q)) return c.value;
  }
  for (const c of options) {
    const names = [c.value, c.label].map(foldCityText);
    if (names.some((name) => q.includes(name) || name.includes(q))) return c.value;
  }
  return '';
}
