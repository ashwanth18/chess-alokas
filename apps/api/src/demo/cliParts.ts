import type { SupabaseClient } from '@supabase/supabase-js';
import { deleteCertificatePdf, saveCertificatePdf } from '../certificates/storage.js';
import { deleteReceipt, saveReceipt } from '../registrations/receipts.js';
import type { DemoAuthAdmin, DemoFileStore } from './runner.js';

const USERS_PER_PAGE = 200;

export function supabaseAuthAdmin(client: SupabaseClient): DemoAuthAdmin {
  return {
    async findUserIdByEmail(email) {
      const target = email.toLowerCase();
      for (let page = 1; ; page++) {
        const { data, error } = await client.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
        if (error) throw new Error(`Could not list sign-in accounts: ${error.message}`);
        const found = data.users.find((u) => u.email?.toLowerCase() === target);
        if (found) return found.id;
        if (data.users.length < USERS_PER_PAGE) return null;
      }
    },
    async createUser({ email, password, displayName }) {
      // email_confirm means no email is sent. app_metadata can't be changed by the user.
      const { data, error } = await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { display_name: displayName },
        app_metadata: { demo_account: true },
      });
      if (error || !data.user) throw new Error(error?.message ?? 'no account returned');
      return { id: data.user.id };
    },
    async updatePassword(userId, password) {
      const { error } = await client.auth.admin.updateUserById(userId, { password });
      if (error) throw new Error(`Could not set a demo password: ${error.message}`);
    },
    async deleteUser(userId) {
      const { error } = await client.auth.admin.deleteUser(userId);
      if (error) throw new Error(error.message);
    },
  };
}

export const cliFileStore: DemoFileStore = {
  saveReceipt: (tournamentId, registrationId, contentType, bytes) =>
    saveReceipt(tournamentId, registrationId, { contentType, bytes }),
  saveCertificate: async (tournamentId, issueId, bytes) =>
    (await saveCertificatePdf(tournamentId, issueId, bytes)).storagePath,
  deleteReceipt,
  deleteCertificate: deleteCertificatePdf,
};
