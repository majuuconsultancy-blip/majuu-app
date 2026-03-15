const ALL_COUNTRIES = ["Canada", "Australia", "UK", "Germany", "USA"];

export const SELF_HELP_TRACK_META = {
  study: {
    label: "Study",
    title: "Study resource hub",
    blurb: "Country-aware school, visa, and move-planning resources.",
  },
  work: {
    label: "Work",
    title: "Work resource hub",
    blurb: "A cleaner path for jobs, permits, relocation, and landing prep.",
  },
  travel: {
    label: "Travel",
    title: "Travel resource hub",
    blurb: "Smart trip-planning resources for visas, stays, and arrival prep.",
  },
};

export const SELF_HELP_CATEGORY_META = {
  study: [
    {
      id: "schools",
      title: "Schools / Universities",
      description: "Featured schools first, then official study finders and trusted discovery tools.",
    },
    {
      id: "scholarships",
      title: "Scholarships",
      description: "Official funding programs and scholarship directories worth checking early.",
    },
    {
      id: "visa",
      title: "Visa / Immigration",
      description: "Go straight to government or official processing guidance.",
    },
    {
      id: "flights",
      title: "Flights",
      description: "Open destination-aware flight searches instead of generic homepages.",
    },
    {
      id: "accommodation",
      title: "Accommodation",
      description: "Arrival stays and student housing resources, with a smart stay prompt where useful.",
    },
    {
      id: "insurance",
      title: "Insurance",
      description: "Travel and student coverage options to compare before departure.",
    },
    {
      id: "finance",
      title: "Financial Prep / Forex",
      description: "Budgeting, exchange-rate, and money-transfer prep.",
    },
    {
      id: "settlement",
      title: "Settlement / SIM / Banking",
      description: "Useful onboarding resources for your first days after arrival.",
    },
    {
      id: "documents",
      title: "Documents / Checklist",
      description: "Admissions and document-prep resources to keep your file clean.",
    },
  ],
  work: [
    {
      id: "jobs",
      title: "Jobs / Employers",
      description: "Featured job platforms plus official hiring portals where available.",
    },
    {
      id: "visa",
      title: "Work Permit / Visa",
      description: "Official work-permit and visa guidance by destination.",
    },
    {
      id: "resume",
      title: "CV / Resume",
      description: "Polish your CV and application pack before you start applying.",
    },
    {
      id: "flights",
      title: "Flights",
      description: "Destination-aware flight shortcuts for relocation planning.",
    },
    {
      id: "accommodation",
      title: "Accommodation",
      description: "Arrival-stay and longer-stay housing resources in one place.",
    },
    {
      id: "insurance",
      title: "Insurance",
      description: "Compare relocation-friendly health and travel cover options.",
    },
    {
      id: "banking",
      title: "Banking / Remittance",
      description: "Move money, compare rates, and prep for your first weeks abroad.",
    },
    {
      id: "settlement",
      title: "Settlement",
      description: "Cost-of-living and relocation resources to help you land smoothly.",
    },
  ],
  travel: [
    {
      id: "visa",
      title: "Visa",
      description: "Official visitor-entry resources first, then support links.",
    },
    {
      id: "flights",
      title: "Flights",
      description: "Fast destination-aware flight searches for the country you picked.",
    },
    {
      id: "accommodation",
      title: "Hotels / Accommodation",
      description: "Smart stay search plus trusted lodging platforms.",
    },
    {
      id: "insurance",
      title: "Insurance",
      description: "Travel cover options for medical surprises and visa requirements.",
    },
    {
      id: "transport",
      title: "Local Transport / Arrival Support",
      description: "Useful arrival-planning links once you land.",
    },
    {
      id: "currency",
      title: "Currency / Travel Prep",
      description: "Rates, transfers, and light prep resources before takeoff.",
    },
  ],
};

const DEFAULT_CITIES = {
  Australia: "Sydney",
  Canada: "Toronto",
  UK: "London",
  Germany: "Berlin",
  USA: "New York",
};

const STUDY_PORTALS = {
  Australia: {
    id: "study-australia-official",
    title: "Study Australia",
    description: "Official destination guide with course and student-life planning.",
    url: "https://www.studyaustralia.gov.au/en",
  },
  Canada: {
    id: "study-canada-educanada",
    title: "EduCanada",
    description: "Official Canadian study portal with school and scholarship guidance.",
    url: "https://www.educanada.ca/",
  },
  UK: {
    id: "study-uk-ucas",
    title: "UCAS",
    description: "Official UK admissions hub for undergraduate applications and timelines.",
    url: "https://www.ucas.com/",
  },
  Germany: {
    id: "study-germany-daad-programmes",
    title: "DAAD Degree Programmes",
    description: "Official degree-program finder for studying in Germany.",
    url: "https://www.daad.de/en/studying-in-germany/universities/all-degree-programmes/",
  },
  USA: {
    id: "study-usa-educationusa",
    title: "EducationUSA",
    description: "Official US study planning resource with admissions prep guidance.",
    url: "https://educationusa.state.gov/",
  },
};

const STUDY_FEATURED_SCHOOLS = {
  Australia: [
    {
      id: "study-au-unimelb",
      title: "University of Melbourne",
      description: "Featured official admissions and course pages for a strong research-led option.",
      url: "https://study.unimelb.edu.au/",
    },
    {
      id: "study-au-unsw",
      title: "UNSW Sydney",
      description: "Featured official admissions, scholarships, and program finder.",
      url: "https://www.unsw.edu.au/study",
    },
  ],
  Canada: [
    {
      id: "study-ca-utoronto",
      title: "University of Toronto",
      description: "Featured official admissions and program information.",
      url: "https://future.utoronto.ca/",
    },
    {
      id: "study-ca-ubc",
      title: "University of British Columbia",
      description: "Featured official admissions and cost-planning guidance.",
      url: "https://you.ubc.ca/",
    },
  ],
  UK: [
    {
      id: "study-uk-manchester",
      title: "The University of Manchester",
      description: "Featured official admissions and international student pages.",
      url: "https://www.manchester.ac.uk/study/",
    },
    {
      id: "study-uk-kcl",
      title: "King's College London",
      description: "Featured official courses, entry requirements, and applicant guidance.",
      url: "https://www.kcl.ac.uk/study",
    },
  ],
  Germany: [
    {
      id: "study-de-tum",
      title: "Technical University of Munich",
      description: "Featured official study and admissions resource for TUM.",
      url: "https://www.tum.de/en/studies",
    },
    {
      id: "study-de-rwth",
      title: "RWTH Aachen University",
      description: "Featured official admissions and program exploration pages.",
      url: "https://www.rwth-aachen.de/go/id/a/?lidx=1",
    },
  ],
  USA: [
    {
      id: "study-us-berkeley",
      title: "UC Berkeley Admissions",
      description: "Featured official admissions guidance for a top US public university.",
      url: "https://admissions.berkeley.edu/",
    },
    {
      id: "study-us-asu",
      title: "Arizona State University",
      description: "Featured official admissions, scholarships, and international student guidance.",
      url: "https://admission.asu.edu/",
    },
  ],
};

const STUDY_SCHOLARSHIP_PORTALS = {
  Australia: {
    id: "study-scholarships-australia-awards",
    title: "Australia Awards Scholarships",
    description: "Official Australian government scholarship opportunities.",
    url: "https://www.dfat.gov.au/people-to-people/australia-awards",
  },
  Canada: {
    id: "study-scholarships-educanada",
    title: "EduCanada Scholarships",
    description: "Official scholarship information for international students in Canada.",
    url: "https://www.educanada.ca/scholarships-bourses/non_can/index.aspx?lang=eng",
  },
  UK: {
    id: "study-scholarships-chevening",
    title: "Chevening Scholarships",
    description: "Official UK government scholarship program for postgraduate study.",
    url: "https://www.chevening.org/scholarships/",
  },
  Germany: {
    id: "study-scholarships-daad",
    title: "DAAD Scholarships",
    description: "Official DAAD funding opportunities for study and research.",
    url: "https://www.daad.de/en/study-and-research-in-germany/scholarships/",
  },
  USA: {
    id: "study-scholarships-fulbright",
    title: "Fulbright Foreign Student Program",
    description: "Official Fulbright study opportunities for international applicants.",
    url: "https://foreign.fulbrightonline.org/",
  },
};

const STUDY_VISA_GUIDES = {
  Australia: {
    id: "study-visa-australia",
    title: "Australia Student Visa (Subclass 500)",
    description: "Official student-visa requirements, evidence, and application guidance.",
    url: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/student-500",
  },
  Canada: {
    id: "study-visa-canada",
    title: "Canada Study Permit",
    description: "Official study-permit eligibility, documents, and process guide.",
    url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/study-canada/study-permit.html",
  },
  UK: {
    id: "study-visa-uk",
    title: "UK Student Visa",
    description: "Official UK student-visa guidance from GOV.UK.",
    url: "https://www.gov.uk/student-visa",
  },
  Germany: {
    id: "study-visa-germany",
    title: "Study in Germany Visa Guide",
    description: "Official study-visa and residence guidance for Germany.",
    url: "https://www.make-it-in-germany.com/en/visa-residence/types/studying",
  },
  USA: {
    id: "study-visa-usa",
    title: "US Student Visa",
    description: "Official F and M visa overview from the US State Department.",
    url: "https://travel.state.gov/content/travel/en/us-visas/study/student-visa.html",
  },
};

const STUDY_SETTLEMENT_GUIDES = {
  Australia: {
    id: "study-settlement-australia",
    title: "Life in Australia for Students",
    description: "Official arrival, living, and student support guidance.",
    url: "https://www.studyaustralia.gov.au/en/life-in-australia",
  },
  Canada: {
    id: "study-settlement-canada",
    title: "Before You Study in Canada",
    description: "Official pre-arrival checklist and preparation guidance.",
    url: "https://www.educanada.ca/study-plan-etudes/before-avant.aspx?lang=eng",
  },
  UK: {
    id: "study-settlement-uk",
    title: "Prepare for the UK",
    description: "Trusted UKCISA guidance for travel, documents, and arrival prep.",
    url: "https://www.ukcisa.org.uk/Information--Advice/Preparing--planning/Before-you-arrive-in-the-UK",
  },
  Germany: {
    id: "study-settlement-germany",
    title: "Living in Germany",
    description: "Official living-cost and arrival guidance for students in Germany.",
    url: "https://www.daad.de/en/studying-in-germany/living-in-germany/",
  },
  USA: {
    id: "study-settlement-usa",
    title: "EducationUSA Pre-Departure",
    description: "Official pre-departure planning for students heading to the US.",
    url: "https://educationusa.state.gov/your-5-steps-us-study/pre-departure",
  },
};

const WORK_JOB_PORTALS = {
  Australia: {
    id: "work-jobs-australia-seek",
    title: "SEEK Australia",
    description: "Featured hiring platform for Australia-based roles.",
    url: "https://www.seek.com.au/",
    labels: ["featured"],
  },
  Canada: {
    id: "work-jobs-canada-jobbank",
    title: "Job Bank",
    description: "Official Canadian job portal with salary and employer insights.",
    url: "https://www.jobbank.gc.ca/home",
    labels: ["official"],
  },
  UK: {
    id: "work-jobs-uk-findajob",
    title: "Find a Job",
    description: "Official UK government job-search portal.",
    url: "https://www.gov.uk/find-a-job",
    labels: ["official"],
  },
  Germany: {
    id: "work-jobs-germany-makeit",
    title: "Make it in Germany Job Listings",
    description: "Official Germany-focused jobs and relocation guidance in one place.",
    url: "https://www.make-it-in-germany.com/en/working-in-germany/job-listings",
    labels: ["official"],
  },
  USA: {
    id: "work-jobs-usa-usajobs",
    title: "USAJOBS",
    description: "Official US federal jobs portal with filters and role details.",
    url: "https://www.usajobs.gov/",
    labels: ["official"],
  },
};

const WORK_VISA_GUIDES = {
  Australia: {
    id: "work-visa-australia",
    title: "Working in Australia",
    description: "Official Australian visa and work-rights overview.",
    url: "https://immi.homeaffairs.gov.au/visas/working-in-australia",
  },
  Canada: {
    id: "work-visa-canada",
    title: "Canada Work Permit",
    description: "Official work-permit types and application guidance.",
    url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/work-canada/permit.html",
  },
  UK: {
    id: "work-visa-uk",
    title: "UK Work Visas",
    description: "Official GOV.UK overview of UK work-visa routes.",
    url: "https://www.gov.uk/browse/visas-immigration/work-visas",
  },
  Germany: {
    id: "work-visa-germany",
    title: "Germany Work Visa for Professionals",
    description: "Official route for qualified professionals moving to Germany.",
    url: "https://www.make-it-in-germany.com/en/visa-residence/types/work-qualified-professionals",
  },
  USA: {
    id: "work-visa-usa",
    title: "US Temporary Worker Visas",
    description: "Official US employment-visa overview and categories.",
    url: "https://travel.state.gov/content/travel/en/us-visas/employment/temporary-worker-visas.html",
  },
};

const WORK_SETTLEMENT_GUIDES = {
  Australia: {
    id: "work-settlement-australia",
    title: "Australia Working and Living Guide",
    description: "Official starting point for work rights and moving plans.",
    url: "https://immi.homeaffairs.gov.au/visas/working-in-australia",
  },
  Canada: {
    id: "work-settlement-canada",
    title: "New to Canada",
    description: "Official newcomer guide for settlement, documents, and first steps.",
    url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/new-immigrants.html",
  },
  UK: {
    id: "work-settlement-uk",
    title: "Moving to the UK",
    description: "Official UK guidance for visas, work, and living setup.",
    url: "https://www.gov.uk/browse/visas-immigration",
  },
  Germany: {
    id: "work-settlement-germany",
    title: "Make it in Germany",
    description: "Official relocation, recognition, and first-weeks guidance.",
    url: "https://www.make-it-in-germany.com/en/",
  },
  USA: {
    id: "work-settlement-usa",
    title: "Working in the United States",
    description: "Official USCIS guidance for work authorization and employment basics.",
    url: "https://www.uscis.gov/working-in-the-united-states",
  },
};

const TRAVEL_VISA_GUIDES = {
  Australia: {
    id: "travel-visa-australia",
    title: "Australia Visitor Visa (Subclass 600)",
    description: "Official visitor-visa guidance for short trips and tourism.",
    url: "https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600",
  },
  Canada: {
    id: "travel-visa-canada",
    title: "Visit Canada",
    description: "Official visitor-visa and eTA planning guide for Canada.",
    url: "https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada.html",
  },
  UK: {
    id: "travel-visa-uk",
    title: "UK Standard Visitor Visa",
    description: "Official GOV.UK resource for tourism and short-stay travel.",
    url: "https://www.gov.uk/standard-visitor",
  },
  Germany: {
    id: "travel-visa-germany",
    title: "Germany Visa and Entry",
    description: "Official foreign-office entry and visa overview for Germany.",
    url: "https://www.auswaertiges-amt.de/en/visa-service/-/231148",
  },
  USA: {
    id: "travel-visa-usa",
    title: "US Visitor Visa",
    description: "Official B-1 and B-2 visitor visa overview from the US State Department.",
    url: "https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html",
  },
};

function createResource(config) {
  return {
    countries: ["*"],
    labels: [],
    linkMode: "direct",
    requiredFields: [],
    priority: 60,
    providerKey: "direct-web",
    redirectEnabled: true,
    affiliateMeta: null,
    ...config,
  };
}

function directResource(config) {
  return createResource({
    ...config,
    linkMode: "direct",
  });
}

function smartResource(config) {
  const labels = Array.isArray(config.labels) ? config.labels : [];
  return createResource({
    ...config,
    linkMode: "smart",
    labels: labels.includes("smart") ? labels : [...labels, "smart"],
  });
}

const resources = [];

for (const country of ALL_COUNTRIES) {
  const studyPortal = STUDY_PORTALS[country];
  resources.push(
    directResource({
      id: studyPortal.id,
      title: studyPortal.title,
      description: studyPortal.description,
      category: "schools",
      tracks: ["study"],
      countries: [country],
      resourceType: "study-directory",
      baseUrl: studyPortal.url,
      labels: ["official"],
      priority: 92,
    })
  );

  for (const school of STUDY_FEATURED_SCHOOLS[country]) {
    resources.push(
      directResource({
        id: school.id,
        title: school.title,
        description: school.description,
        category: "schools",
        tracks: ["study"],
        countries: [country],
        resourceType: "school",
        baseUrl: school.url,
        labels: ["featured"],
        priority: 126,
      })
    );
  }

  const scholarship = STUDY_SCHOLARSHIP_PORTALS[country];
  resources.push(
    directResource({
      id: scholarship.id,
      title: scholarship.title,
      description: scholarship.description,
      category: "scholarships",
      tracks: ["study"],
      countries: [country],
      resourceType: "scholarship",
      baseUrl: scholarship.url,
      labels: ["official"],
      priority: 88,
    })
  );

  const studyVisa = STUDY_VISA_GUIDES[country];
  resources.push(
    directResource({
      id: studyVisa.id,
      title: studyVisa.title,
      description: studyVisa.description,
      category: "visa",
      tracks: ["study"],
      countries: [country],
      resourceType: "visa",
      baseUrl: studyVisa.url,
      labels: ["official"],
      priority: 92,
    })
  );

  const studySettlement = STUDY_SETTLEMENT_GUIDES[country];
  resources.push(
    directResource({
      id: studySettlement.id,
      title: studySettlement.title,
      description: studySettlement.description,
      category: "settlement",
      tracks: ["study"],
      countries: [country],
      resourceType: "settlement",
      baseUrl: studySettlement.url,
      labels: country === "UK" ? [] : ["official"],
      priority: 80,
    })
  );

  const workJobs = WORK_JOB_PORTALS[country];
  resources.push(
    directResource({
      id: workJobs.id,
      title: workJobs.title,
      description: workJobs.description,
      category: "jobs",
      tracks: ["work"],
      countries: [country],
      resourceType: "jobs",
      baseUrl: workJobs.url,
      labels: workJobs.labels || [],
      priority: (workJobs.labels || []).includes("featured") ? 116 : 90,
    })
  );

  const workVisa = WORK_VISA_GUIDES[country];
  resources.push(
    directResource({
      id: workVisa.id,
      title: workVisa.title,
      description: workVisa.description,
      category: "visa",
      tracks: ["work"],
      countries: [country],
      resourceType: "work-visa",
      baseUrl: workVisa.url,
      labels: ["official"],
      priority: 92,
    })
  );

  const workSettlement = WORK_SETTLEMENT_GUIDES[country];
  resources.push(
    directResource({
      id: workSettlement.id,
      title: workSettlement.title,
      description: workSettlement.description,
      category: "settlement",
      tracks: ["work"],
      countries: [country],
      resourceType: "settlement",
      baseUrl: workSettlement.url,
      labels: country === "Australia" ? ["official"] : [],
      priority: 76,
    })
  );

  const travelVisa = TRAVEL_VISA_GUIDES[country];
  resources.push(
    directResource({
      id: travelVisa.id,
      title: travelVisa.title,
      description: travelVisa.description,
      category: "visa",
      tracks: ["travel"],
      countries: [country],
      resourceType: "travel-visa",
      baseUrl: travelVisa.url,
      labels: ["official"],
      priority: 92,
    })
  );
}

resources.push(
  directResource({
    id: "study-global-studyportals",
    title: "Studyportals",
    description: "Browse programs by country, degree level, and field before shortlisting.",
    category: "schools",
    tracks: ["study"],
    resourceType: "study-directory",
    baseUrl: "https://www.studyportals.com/",
    labels: ["featured", "recommended"],
    providerKey: "studyportals",
    priority: 82,
  }),
  directResource({
    id: "study-global-qs",
    title: "QS Top Universities",
    description: "Compare rankings, subjects, and school profiles when building a shortlist.",
    category: "schools",
    tracks: ["study"],
    resourceType: "ranking",
    baseUrl: "https://www.topuniversities.com/",
    priority: 72,
  }),
  directResource({
    id: "study-global-erasmus",
    title: "Erasmus+",
    description: "Official mobility and scholarship opportunities across Europe.",
    category: "scholarships",
    tracks: ["study"],
    resourceType: "scholarship",
    baseUrl: "https://erasmus-plus.ec.europa.eu/",
    labels: ["official"],
    priority: 72,
  }),
  directResource({
    id: "study-global-vfs",
    title: "VFS Global",
    description: "Check if your destination uses VFS for biometrics or submission support.",
    category: "visa",
    tracks: ["study"],
    resourceType: "visa-support",
    baseUrl: "https://www.vfsglobal.com/",
    priority: 56,
  }),
  directResource({
    id: "study-global-embassypages",
    title: "EmbassyPages",
    description: "Find embassies and consulates for cross-checking official contact details.",
    category: "visa",
    tracks: ["study"],
    resourceType: "embassy-directory",
    baseUrl: "https://www.embassypages.com/",
    priority: 52,
  }),
  smartResource({
    id: "global-google-flights-smart",
    title: "Google Flights Smart Search",
    description: "Open a Nairobi-to-destination flight search already pointed at your country.",
    category: "flights",
    tracks: ["study", "work", "travel"],
    resourceType: "flight-search",
    baseUrl: "https://www.google.com/travel/flights",
    smartBuilder: "google-flights",
    labels: ["featured"],
    providerKey: "google-flights",
    priority: 132,
  }),
  directResource({
    id: "global-skyscanner",
    title: "Skyscanner",
    description: "Compare fares and keep an eye on price movement once you shortlist dates.",
    category: "flights",
    tracks: ["study", "work", "travel"],
    resourceType: "flight-compare",
    baseUrl: "https://www.skyscanner.net/",
    labels: ["recommended"],
    providerKey: "skyscanner",
    priority: 64,
  }),
  smartResource({
    id: "global-booking-smart-stay",
    title: "Booking.com Smart Stay",
    description: "Use a light stay prompt to jump into a destination-aware stay search.",
    category: "accommodation",
    tracks: ["study", "work", "travel"],
    resourceType: "stay-search",
    baseUrl: "https://www.booking.com/searchresults.html",
    smartBuilder: "booking-stay",
    requiredFields: ["city", "stayType", "checkIn"],
    labels: ["featured"],
    providerKey: "booking",
    priority: 130,
  }),
  directResource({
    id: "study-housing-housinganywhere",
    title: "HousingAnywhere",
    description: "Longer-stay rooms and apartments that work well for students and movers.",
    category: "accommodation",
    tracks: ["study", "work"],
    resourceType: "housing",
    baseUrl: "https://housinganywhere.com/",
    labels: ["recommended"],
    priority: 70,
  }),
  directResource({
    id: "study-housing-studentcom",
    title: "Student.com",
    description: "Student-focused housing platform worth checking after you shortlist schools.",
    category: "accommodation",
    tracks: ["study"],
    resourceType: "student-housing",
    baseUrl: "https://www.student.com/",
    priority: 68,
  }),
  directResource({
    id: "travel-housing-hostelworld",
    title: "Hostelworld",
    description: "Budget travel stays and hostel discovery for lighter travel plans.",
    category: "accommodation",
    tracks: ["travel"],
    resourceType: "travel-stay",
    baseUrl: "https://www.hostelworld.com/",
    priority: 66,
  }),
  directResource({
    id: "study-insurance-safetywing",
    title: "SafetyWing",
    description: "Simple international travel and nomad cover worth comparing for transit periods.",
    category: "insurance",
    tracks: ["study", "work", "travel"],
    resourceType: "insurance",
    baseUrl: "https://safetywing.com/",
    labels: ["recommended"],
    priority: 70,
  }),
  directResource({
    id: "study-insurance-allianz",
    title: "Allianz Travel Insurance",
    description: "Established travel-insurance provider to compare against other quotes.",
    category: "insurance",
    tracks: ["study", "work", "travel"],
    resourceType: "insurance",
    baseUrl: "https://www.allianztravelinsurance.com/",
    priority: 64,
  }),
  directResource({
    id: "study-finance-wise",
    title: "Wise",
    description: "Monitor exchange rates and move money with transparent fees.",
    category: "finance",
    tracks: ["study"],
    resourceType: "forex",
    baseUrl: "https://wise.com/",
    labels: ["recommended"],
    providerKey: "wise",
    priority: 72,
  }),
  directResource({
    id: "study-finance-xe",
    title: "XE Currency",
    description: "Quick exchange-rate checks while budgeting tuition, rent, and flights.",
    category: "finance",
    tracks: ["study", "travel"],
    resourceType: "currency",
    baseUrl: "https://www.xe.com/",
    providerKey: "xe",
    priority: 60,
  }),
  directResource({
    id: "study-settlement-airalo",
    title: "Airalo eSIM",
    description: "Set up mobile data before arrival so your first hours feel less chaotic.",
    category: "settlement",
    tracks: ["study", "work", "travel"],
    resourceType: "esim",
    baseUrl: "https://www.airalo.com/",
    labels: ["recommended"],
    providerKey: "airalo",
    priority: 58,
  }),
  directResource({
    id: "study-docs-ielts",
    title: "IELTS",
    description: "Official language-test registration and score information.",
    category: "documents",
    tracks: ["study"],
    resourceType: "test",
    baseUrl: "https://www.ielts.org/",
    labels: ["official"],
    priority: 70,
  }),
  directResource({
    id: "study-docs-toefl",
    title: "TOEFL",
    description: "Official TOEFL registration and score-reporting guidance.",
    category: "documents",
    tracks: ["study"],
    resourceType: "test",
    baseUrl: "https://www.ets.org/toefl",
    labels: ["official"],
    priority: 66,
  }),
  directResource({
    id: "study-docs-wes",
    title: "WES Credential Evaluation",
    description: "Document and transcript evaluation used by many study destinations.",
    category: "documents",
    tracks: ["study"],
    resourceType: "credential-eval",
    baseUrl: "https://www.wes.org/",
    priority: 64,
  }),
  directResource({
    id: "work-jobs-linkedin",
    title: "LinkedIn Jobs",
    description: "Featured search hub for international hiring and employer research.",
    category: "jobs",
    tracks: ["work"],
    resourceType: "jobs",
    baseUrl: "https://www.linkedin.com/jobs/",
    labels: ["featured"],
    providerKey: "linkedin-jobs",
    priority: 120,
  }),
  directResource({
    id: "work-jobs-indeed",
    title: "Indeed",
    description: "Broad job-search coverage when you want more role volume.",
    category: "jobs",
    tracks: ["work"],
    resourceType: "jobs",
    baseUrl: "https://www.indeed.com/",
    priority: 74,
  }),
  directResource({
    id: "work-visa-vfs",
    title: "VFS Global",
    description: "Useful if your destination routes visa logistics through VFS.",
    category: "visa",
    tracks: ["work"],
    resourceType: "visa-support",
    baseUrl: "https://www.vfsglobal.com/",
    priority: 54,
  }),
  directResource({
    id: "work-resume-canva",
    title: "Canva Resume Builder",
    description: "Fast resume layout refresh when your CV needs a cleaner presentation.",
    category: "resume",
    tracks: ["work"],
    resourceType: "resume",
    baseUrl: "https://www.canva.com/resumes/templates/",
    priority: 76,
  }),
  directResource({
    id: "work-resume-europass",
    title: "Europass CV",
    description: "Useful if you are applying into Europe or want a structured CV baseline.",
    category: "resume",
    tracks: ["work"],
    resourceType: "resume",
    baseUrl: "https://europa.eu/europass/en/create-europass-cv",
    labels: ["official"],
    priority: 70,
  }),
  directResource({
    id: "work-insurance-genki",
    title: "Genki",
    description: "International health cover option worth comparing for longer stays.",
    category: "insurance",
    tracks: ["work"],
    resourceType: "insurance",
    baseUrl: "https://genki.world/",
    priority: 64,
  }),
  directResource({
    id: "work-banking-wise",
    title: "Wise Account",
    description: "Useful for multi-currency budgeting and early salary planning.",
    category: "banking",
    tracks: ["work"],
    resourceType: "banking",
    baseUrl: "https://wise.com/",
    labels: ["recommended"],
    providerKey: "wise",
    priority: 74,
  }),
  directResource({
    id: "work-banking-worldremit",
    title: "WorldRemit",
    description: "Compare remittance routes and transfer fees before you move.",
    category: "banking",
    tracks: ["work"],
    resourceType: "remittance",
    baseUrl: "https://www.worldremit.com/",
    priority: 62,
  }),
  directResource({
    id: "work-settlement-numbeo",
    title: "Numbeo Cost of Living",
    description: "Compare rent, groceries, and transport costs city by city.",
    category: "settlement",
    tracks: ["work"],
    resourceType: "cost-of-living",
    baseUrl: "https://www.numbeo.com/cost-of-living/",
    labels: ["recommended"],
    providerKey: "numbeo",
    priority: 70,
  }),
  directResource({
    id: "travel-visa-vfs",
    title: "VFS Global",
    description: "Helpful when your destination uses VFS for appointment or document routing.",
    category: "visa",
    tracks: ["travel"],
    resourceType: "visa-support",
    baseUrl: "https://www.vfsglobal.com/",
    priority: 52,
  }),
  directResource({
    id: "travel-visa-embassy",
    title: "EmbassyPages",
    description: "Cross-check embassy details and submission locations before you move.",
    category: "visa",
    tracks: ["travel"],
    resourceType: "embassy-directory",
    baseUrl: "https://www.embassypages.com/",
    priority: 48,
  }),
  directResource({
    id: "travel-insurance-worldnomads",
    title: "World Nomads",
    description: "Travel-focused cover for people comparing flexible trip insurance.",
    category: "insurance",
    tracks: ["travel"],
    resourceType: "insurance",
    baseUrl: "https://www.worldnomads.com/",
    priority: 68,
  }),
  directResource({
    id: "travel-transport-rome2rio",
    title: "Rome2Rio",
    description: "See how to move between airports, hotels, and city centers after arrival.",
    category: "transport",
    tracks: ["travel"],
    resourceType: "transport",
    baseUrl: "https://www.rome2rio.com/",
    labels: ["recommended"],
    providerKey: "rome2rio",
    priority: 72,
  }),
  directResource({
    id: "travel-transport-google-maps",
    title: "Google Maps",
    description: "Save hotels, routes, and must-visit spots in one place before your trip.",
    category: "transport",
    tracks: ["travel"],
    resourceType: "maps",
    baseUrl: "https://www.google.com/maps",
    priority: 62,
  }),
  directResource({
    id: "travel-currency-wise",
    title: "Wise Card and Rates",
    description: "Check exchange rates and decide how you want to spend abroad.",
    category: "currency",
    tracks: ["travel"],
    resourceType: "currency",
    baseUrl: "https://wise.com/",
    labels: ["recommended"],
    providerKey: "wise",
    priority: 74,
  }),
  directResource({
    id: "travel-currency-xe",
    title: "XE Currency",
    description: "Quick rate checks while pricing hotels, tickets, and local transport.",
    category: "currency",
    tracks: ["travel"],
    resourceType: "currency",
    baseUrl: "https://www.xe.com/",
    providerKey: "xe",
    priority: 60,
  })
);

export const SELF_HELP_RESOURCES = resources;

export function getSelfHelpCountries() {
  return [...ALL_COUNTRIES];
}

export function getDefaultCityForCountry(country) {
  return DEFAULT_CITIES[String(country || "").trim()] || "";
}

function isTrackMatch(resource, track) {
  return Array.isArray(resource.tracks) && resource.tracks.includes(track);
}

function isCountryMatch(resource, country) {
  const supported = Array.isArray(resource.countries) ? resource.countries : ["*"];
  return supported.includes("*") || supported.includes(country);
}

const LABEL_ORDER_WEIGHT = {
  featured: 500,
  partner: 420,
  affiliate: 380,
  recommended: 320,
  official: 260,
};

function getLabelWeight(resource) {
  const labels = Array.isArray(resource?.labels) ? resource.labels : [];
  return labels.reduce(
    (highest, label) => Math.max(highest, Number(LABEL_ORDER_WEIGHT[label] || 0)),
    0
  );
}

function byPriority(a, b) {
  if (getLabelWeight(b) !== getLabelWeight(a)) {
    return getLabelWeight(b) - getLabelWeight(a);
  }
  if (Number(b.priority || 0) !== Number(a.priority || 0)) {
    return Number(b.priority || 0) - Number(a.priority || 0);
  }
  return String(a.title || "").localeCompare(String(b.title || ""));
}

export function getSelfHelpResourceById(resourceId) {
  return SELF_HELP_RESOURCES.find((resource) => resource.id === resourceId) || null;
}

export function getSelfHelpResourcesForCategory(track, country, categoryId) {
  return SELF_HELP_RESOURCES.filter(
    (resource) =>
      resource.category === categoryId &&
      isTrackMatch(resource, track) &&
      isCountryMatch(resource, country)
  ).sort(byPriority);
}

export function getSelfHelpSections(track, country) {
  const categories = SELF_HELP_CATEGORY_META[track] || [];

  return categories
    .map((category) => ({
      ...category,
      resources: getSelfHelpResourcesForCategory(track, country, category.id),
    }))
    .filter((category) => category.resources.length > 0);
}
