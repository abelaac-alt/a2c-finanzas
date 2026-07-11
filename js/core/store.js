export const state = {
  session: null,
  user: null,
  profile: null,
  permissions: null,
  tab: 'home',

  ledger: [],
  piggies: [],
  piggyTx: [],
  folders: [],
  goals: [],
  contributions: [],
  notifications: [],
  users: [],
  goalMembers: [],
  invitations: [],
  expenseSplits: [],
  splitMembers: [],

  activityFilter: {
    query: '',
    kind: '',
    from: '',
    to: '',
    folderId: ''
  }
};
