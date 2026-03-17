export const ANALYTICS_EVENT_TYPES = Object.freeze({
  SIGNUP_COMPLETED: "signup_completed",
  PROFILE_COMPLETED: "profile_completed",

  JOURNEY_SETUP_STARTED: "journey_setup_started",
  JOURNEY_SETUP_COMPLETED: "journey_setup_completed",
  JOURNEY_TRACK_SELECTED: "journey_track_selected",
  JOURNEY_COUNTRY_SELECTED: "journey_country_selected",
  JOURNEY_CUSTOM_COUNTRY_ENTERED: "journey_custom_country_entered",
  JOURNEY_STAGE_SELECTED: "journey_stage_selected",

  APP_LAUNCH_WITH_SAVED_JOURNEY: "app_launch_with_saved_journey",
  APP_LAUNCH_WITHOUT_SAVED_JOURNEY: "app_launch_without_saved_journey",
  TRACK_SCREEN_OPENED: "track_screen_opened",
  COUNTRY_SELECTED: "country_selected",

  SELFHELP_OPENED: "selfhelp_opened",
  WEHELP_OPENED: "wehelp_opened",
  SELFHELP_LINK_CLICKED: "selfhelp_link_clicked",
  REQUEST_SUBMITTED: "request_submitted",

  NEWS_OPENED: "news_opened",
});

export const ANALYTICS_SELFHELP_CLICK_BUCKETS = Object.freeze({
  AFFILIATE: "affiliate",
  OTHER: "other",
});

