/**
 * Empty tenant seed — never copy ASCENDANTS events/items/officer names.
 */
export const DEFAULT_CONFIGURATION = {
  guildDisplayName: '',
  timezone: 'Asia/Manila',
  isForceLocked: false,
  adminRoles: [],
  helpEmbedUrl: '',
  raidHelpEmbedUrl: '',
  priorityLookbackDays: 30,
  specialEventCategories: ['Raid', 'Meeting', 'PVP', 'Casual'],
  items: [],
  events: {},
  liveRaidMaxConfigs: 5,
  liveRaidMaxWarRooms: 2,
  attendancePollInterval: 5,
  attendanceMaxDuration: 40,
  defaultLeaveCredits: 3,
  warRooms: {},
  jobs: {},
  roles: {},
};

export default DEFAULT_CONFIGURATION;
