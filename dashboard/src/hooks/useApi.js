// ============================================
// React Query hooks — wraps api.js functions
// ============================================

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import * as api from '../api';

// ---------- Query Keys ----------
export const keys = {
  barbers: ['barbers'],
  services: ['services'],
  bookings: (params) => ['bookings', params],
  blockedSlots: (params) => ['blockedSlots', params],
  guestAssignments: ['guestAssignments'],
  barberSchedule: (id) => ['barberSchedule', id],
  barberGuestDays: (id) => ['barberGuestDays', id],
  clients: (params) => ['clients', params],
  client: (id) => ['client', id],
  inactiveClients: ['inactiveClients'],
  bookingsHistory: (params) => ['bookingsHistory', params],
  dashboard: (params) => ['dashboard', params],
  revenue: (params) => ['revenue', params],
  peakHours: (params) => ['peakHours', params],
  occupancy: (params) => ['occupancy', params],
  serviceStats: (params) => ['serviceStats', params],
  barberStats: (params) => ['barberStats', params],
  memberStats: ['memberStats'],
  notificationLogs: (params) => ['notificationLogs', params],
  notificationStats: ['notificationStats'],
  brevoStatus: ['brevoStatus'],
  systemHealth: ['systemHealth'],
  waitlist: (params) => ['waitlist', params],
  waitlistCount: ['waitlistCount'],
  automationTriggers: ['automationTriggers'],
  campaigns: ['campaigns'],
  auditLog: (params) => ['auditLog', params],
};

// ---------- Barbers ----------
export function useBarbers(options) {
  return useQuery({
    queryKey: keys.barbers,
    queryFn: api.getBarbers,
    staleTime: 5 * 60_000,
    ...options,
  });
}

export function useBarberSchedule(id, options) {
  return useQuery({
    queryKey: keys.barberSchedule(id),
    queryFn: () => api.getBarberSchedule(id),
    enabled: !!id,
    staleTime: 5 * 60_000,
    ...options,
  });
}

export function useBarberGuestDays(id, options) {
  return useQuery({
    queryKey: keys.barberGuestDays(id),
    queryFn: () => api.getBarberGuestDays(id),
    enabled: !!id,
    staleTime: 5 * 60_000,
    ...options,
  });
}

export function useUpdateBarber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.updateBarber(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.barbers }),
  });
}

export function useUpdateBarberSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, schedules }) => api.updateBarberSchedule(id, schedules),
    onSuccess: (_, { id }) => qc.invalidateQueries({ queryKey: keys.barberSchedule(id) }),
  });
}

export function useAddBarberOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.addBarberOverride(id, data),
    onSuccess: (_, { id }) => qc.invalidateQueries({ queryKey: keys.barberSchedule(id) }),
  });
}

export function useDeleteBarberOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.deleteBarberOverride(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['barberSchedule'] }),
  });
}

export function useAddBarberGuestDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.addBarberGuestDay(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: keys.barberGuestDays(id) });
      qc.invalidateQueries({ queryKey: keys.guestAssignments });
    },
  });
}

export function useDeleteBarberGuestDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.deleteBarberGuestDay(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['barberGuestDays'] });
      qc.invalidateQueries({ queryKey: keys.guestAssignments });
    },
  });
}

// ---------- Services ----------
export function useServices(options) {
  return useQuery({
    queryKey: keys.services,
    queryFn: api.getServices,
    staleTime: 5 * 60_000,
    ...options,
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createService,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.services }),
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.updateService(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.services }),
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteService,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.services }),
  });
}

// ---------- Bookings (Planning) ----------
export function useBookings(params, options) {
  return useQuery({
    queryKey: keys.bookings(params),
    queryFn: () => api.getBookings(params),
    staleTime: 30_000,
    ...options,
  });
}

export function useBlockedSlots(params, options) {
  return useQuery({
    queryKey: keys.blockedSlots(params),
    queryFn: () => api.getBlockedSlots(params),
    staleTime: 30_000,
    ...options,
  });
}

export function useGuestAssignments(options) {
  return useQuery({
    queryKey: keys.guestAssignments,
    queryFn: () => api.getGuestAssignments().catch(() => []),
    staleTime: 5 * 60_000,
    ...options,
  });
}

export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createBooking,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  });
}

export function useUpdateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.updateBooking(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  });
}

export function useUpdateBookingStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) => api.updateBookingStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  });
}

export function useDeleteBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, notify }) => api.deleteBooking(id, { notify }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  });
}

export function useDeleteBookingGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ groupId, notify, futureOnly }) => api.deleteBookingGroup(groupId, { notify, futureOnly }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bookings'] }),
  });
}

export function useCreateBlockedSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createBlockedSlot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blockedSlots'] }),
  });
}

export function useDeleteBlockedSlot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteBlockedSlot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['blockedSlots'] }),
  });
}

// ---------- Clients ----------
export function useClients(params, options) {
  return useQuery({
    queryKey: keys.clients(params),
    queryFn: ({ signal }) => api.getClients(params, signal),
    staleTime: 30_000,
    ...options,
  });
}

export function useClient(id, options) {
  return useQuery({
    queryKey: keys.client(id),
    queryFn: () => api.getClient(id),
    enabled: !!id,
    staleTime: 60_000,
    ...options,
  });
}

export function useInactiveClients(options) {
  return useQuery({
    queryKey: keys.inactiveClients,
    queryFn: api.getInactiveClients,
    staleTime: 5 * 60_000,
    ...options,
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.updateClient(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: keys.client(id) });
      qc.invalidateQueries({ queryKey: ['clients'] });
    },
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteClient,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['clients'] }),
  });
}

// ---------- History ----------
export function useBookingsHistory(params, options) {
  return useQuery({
    queryKey: keys.bookingsHistory(params),
    queryFn: () => api.getBookingsHistory(params),
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    ...options,
  });
}

// ---------- Analytics ----------
export function useDashboard(params, options) {
  return useQuery({
    queryKey: keys.dashboard(params),
    queryFn: () => api.getDashboard(params),
    staleTime: 60_000,
    ...options,
  });
}

export function useRevenue(params, options) {
  return useQuery({
    queryKey: keys.revenue(params),
    queryFn: () => api.getRevenue(params),
    staleTime: 60_000,
    ...options,
  });
}

export function usePeakHours(params, options) {
  return useQuery({
    queryKey: keys.peakHours(params),
    queryFn: () => api.getPeakHours(params),
    staleTime: 5 * 60_000,
    ...options,
  });
}

export function useOccupancy(params, options) {
  return useQuery({
    queryKey: keys.occupancy(params),
    queryFn: () => api.getOccupancy(params),
    staleTime: 60_000,
    ...options,
  });
}

export function useServiceStats(params, options) {
  return useQuery({
    queryKey: keys.serviceStats(params),
    queryFn: () => api.getServiceStats(params),
    staleTime: 60_000,
    ...options,
  });
}

export function useBarberStats(params, options) {
  return useQuery({
    queryKey: keys.barberStats(params),
    queryFn: () => api.getBarberStats(params),
    staleTime: 60_000,
    ...options,
  });
}

export function useMemberStats(options) {
  return useQuery({
    queryKey: keys.memberStats,
    queryFn: api.getMemberStats,
    staleTime: 5 * 60_000,
    ...options,
  });
}

// ---------- Notifications ----------
export function useNotificationLogs(params, options) {
  return useQuery({
    queryKey: keys.notificationLogs(params),
    queryFn: () => api.getNotificationLogs(params),
    staleTime: 30_000,
    ...options,
  });
}

export function useNotificationStats(options) {
  return useQuery({
    queryKey: keys.notificationStats,
    queryFn: api.getNotificationStats,
    staleTime: 60_000,
    ...options,
  });
}

export function useBrevoStatus(options) {
  return useQuery({
    queryKey: keys.brevoStatus,
    queryFn: api.getBrevoStatus,
    staleTime: 60_000,
    ...options,
  });
}

export function usePurgeFailedNotifications() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.purgeFailedNotifications,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.notificationStats });
      qc.invalidateQueries({ queryKey: ['notificationLogs'] });
    },
  });
}

// ---------- System ----------
export function useSystemHealth(options) {
  return useQuery({
    queryKey: keys.systemHealth,
    queryFn: api.getSystemHealth,
    staleTime: 15_000,
    refetchInterval: 30_000,
    ...options,
  });
}

// ---------- Automation ----------
export function useAutomationTriggers(options) {
  return useQuery({
    queryKey: keys.automationTriggers,
    queryFn: api.getAutomationTriggers,
    staleTime: 60_000,
    ...options,
  });
}

export function useUpdateAutomationTrigger() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, data }) => api.updateAutomationTrigger(type, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.automationTriggers }),
  });
}

// ---------- Waitlist ----------
export function useWaitlist(params, options) {
  return useQuery({
    queryKey: keys.waitlist(params),
    queryFn: () => api.getWaitlist(params),
    staleTime: 30_000,
    ...options,
  });
}

export function useWaitlistCount(options) {
  return useQuery({
    queryKey: keys.waitlistCount,
    queryFn: api.getWaitlistCount,
    staleTime: 30_000,
    ...options,
  });
}

export function useAddToWaitlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.addToWaitlist,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['waitlist'] });
      qc.invalidateQueries({ queryKey: keys.waitlistCount });
    },
  });
}

export function useUpdateWaitlistEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }) => api.updateWaitlistEntry(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['waitlist'] });
      qc.invalidateQueries({ queryKey: keys.waitlistCount });
    },
  });
}

export function useDeleteWaitlistEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteWaitlistEntry,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['waitlist'] });
      qc.invalidateQueries({ queryKey: keys.waitlistCount });
    },
  });
}

// ---------- Campaigns ----------
export function useCampaigns(options) {
  return useQuery({
    queryKey: keys.campaigns,
    queryFn: api.getCampaigns,
    staleTime: 60_000,
    ...options,
  });
}

export function useCampaignROI(id, options) {
  return useQuery({
    queryKey: ['campaignROI', id],
    queryFn: () => api.getCampaignROI(id),
    enabled: !!id,
    staleTime: 60_000,
    ...options,
  });
}

// ---------- Audit Log ----------
export function useAuditLog(params, options) {
  return useQuery({
    queryKey: keys.auditLog(params),
    queryFn: () => api.getAuditLog(params),
    staleTime: 30_000,
    ...options,
  });
}

// ---------- SMS / Mailing ----------
export function useSendSms() {
  return useMutation({ mutationFn: api.sendSms });
}

export function useSendMailing() {
  return useMutation({ mutationFn: api.sendMailing });
}
