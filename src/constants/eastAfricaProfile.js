import { KENYA_COUNTY_OPTIONS } from "./kenyaCounties";

export const EAST_AFRICA_RESIDENCE_COUNTRIES = [
  "Kenya",
  "Uganda",
  "Tanzania",
  "Rwanda",
  "Namibia",
  "Ethiopia",
];

export const EAST_AFRICA_PHONE_CODES = {
  Kenya: "+254",
  Uganda: "+256",
  Tanzania: "+255",
  Rwanda: "+250",
  Namibia: "+264",
  Ethiopia: "+251",
};

export const EAST_AFRICA_COUNTY_OPTIONS = {
  Kenya: KENYA_COUNTY_OPTIONS,
  Uganda: ["Central Region", "Eastern Region", "Northern Region", "Western Region"],
  Tanzania: [
    "Arusha",
    "Dar es Salaam",
    "Dodoma",
    "Geita",
    "Iringa",
    "Kagera",
    "Katavi",
    "Kigoma",
    "Kilimanjaro",
    "Lindi",
    "Manyara",
    "Mara",
    "Mbeya",
    "Morogoro",
    "Mtwara",
    "Mwanza",
    "Njombe",
    "Pemba North",
    "Pemba South",
    "Pwani",
    "Rukwa",
    "Ruvuma",
    "Shinyanga",
    "Simiyu",
    "Singida",
    "Songwe",
    "Tabora",
    "Tanga",
    "Zanzibar Central/South",
    "Zanzibar North",
    "Zanzibar Urban/West",
  ],
  Rwanda: [
    "Kigali City",
    "Northern Province",
    "Southern Province",
    "Eastern Province",
    "Western Province",
  ],
  Namibia: [
    "Erongo",
    "Hardap",
    "Karas",
    "Kavango East",
    "Kavango West",
    "Khomas",
    "Kunene",
    "Ohangwena",
    "Omaheke",
    "Omusati",
    "Oshana",
    "Oshikoto",
    "Otjozondjupa",
    "Zambezi",
  ],
  Ethiopia: [
    "Addis Ababa",
    "Afar",
    "Amhara",
    "Benishangul-Gumuz",
    "Dire Dawa",
    "Gambela",
    "Harari",
    "Oromia",
    "Sidama",
    "Somali",
    "South Ethiopia",
    "South West Ethiopia Peoples'",
    "Tigray",
  ],
};

export function getEastAfricaPhoneCode(countryOfResidence) {
  return EAST_AFRICA_PHONE_CODES[String(countryOfResidence || "").trim()] || "";
}

export function getEastAfricaCountyOptions(countryOfResidence) {
  const key = String(countryOfResidence || "").trim();
  return Array.isArray(EAST_AFRICA_COUNTY_OPTIONS[key]) ? EAST_AFRICA_COUNTY_OPTIONS[key] : [];
}

export function getEastAfricaResidenceFromPhoneCode(phoneCode) {
  const code = String(phoneCode || "").trim();
  if (!code) return "";
  return (
    Object.entries(EAST_AFRICA_PHONE_CODES).find(([, value]) => value === code)?.[0] || ""
  );
}
