'use strict';

const STORE_KEY = 'sync-profiles';

/**
 * Sync Profiles Service
 * 
 * A profile defines WHAT and HOW to sync for a content type:
 * - direction: push, pull, both
 * - conflictStrategy: latest, local_wins, remote_wins
 * - fieldPolicies: per-field direction overrides (advanced mode)
 * 
 * Execution settings (WHEN to sync) are managed separately in sync-execution service.
 * 
 * Profile structure:
 * {
 *   id: string,
 *   name: string,
 *   contentType: string (uid),
 *   direction: 'push' | 'pull' | 'both',
 *   conflictStrategy: 'latest' | 'local_wins' | 'remote_wins',
 *   isActive: boolean,
 *   isSimple: boolean (false = advanced mode with field policies),
 *   fieldPolicies: [{ field, direction }],
 *   createdAt: ISO string,
 *   updatedAt: ISO string
 * }
 */
module.exports = ({ strapi }) => {
  function getStore() {
    return strapi.store({ type: 'plugin', name: 'strapi-content-sync-pro' });
  }

  function generateId() {
    return `profile_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  const VALID_DIRECTIONS = ['push', 'pull', 'both', 'none'];
  const VALID_CONFLICT_STRATEGIES = ['latest', 'local_wins', 'remote_wins'];

  return {
    /**
     * Get all sync profiles
     */
    async getProfiles() {
      const store = getStore();
      const data = await store.get({ key: STORE_KEY });
      return data || [];
    },

    /**
     * Get a single profile by ID
     */
    async getProfile(id) {
      const profiles = await this.getProfiles();
      return profiles.find((p) => p.id === id) || null;
    },

    /**
     * Get active profile for a content type
     */
    async getActiveProfileForContentType(contentTypeUid) {
      const profiles = await this.getProfiles();
      return profiles.find((p) => p.contentType === contentTypeUid && p.isActive) || null;
    },

    /**
     * Get all profiles for a content type
     */
    async getProfilesForContentType(contentTypeUid) {
      const profiles = await this.getProfiles();
      return profiles.filter((p) => p.contentType === contentTypeUid);
    },

    /**
     * Auto-generate default profiles for a content type
     * Creates: Full Push, Full Pull, Bidirectional (Merge)
     */
    async autoGenerateProfiles(contentTypeUid) {
      const existingProfiles = await this.getProfilesForContentType(contentTypeUid);
      if (existingProfiles.length > 0) {
        return existingProfiles; // Don't regenerate if profiles exist
      }

      const contentType = strapi.contentTypes[contentTypeUid];
      const displayName = contentType?.info?.displayName || contentTypeUid;

      const defaultProfiles = [
        {
          name: `${displayName} - Full Push`,
          contentType: contentTypeUid,
          direction: 'push',
          conflictStrategy: 'local_wins',
          isActive: false,
          isSimple: true,
          fieldPolicies: [],
        },
        {
          name: `${displayName} - Full Pull`,
          contentType: contentTypeUid,
          direction: 'pull',
          conflictStrategy: 'remote_wins',
          isActive: false,
          isSimple: true,
          fieldPolicies: [],
        },
        {
          name: `${displayName} - Bidirectional`,
          contentType: contentTypeUid,
          direction: 'both',
          conflictStrategy: 'latest',
          isActive: true, // Default active profile
          isSimple: true,
          fieldPolicies: [],
        },
      ];

      const created = [];
      for (const profileData of defaultProfiles) {
        const profile = await this.createProfile(profileData);
        created.push(profile);
      }

      return created;
    },

    /**
     * Create a new sync profile
     */
    async createProfile(profileData) {
      const store = getStore();
      const profiles = await this.getProfiles();

      if (!profileData.name) {
        throw new Error('Profile name is required');
      }
      if (!profileData.contentType) {
        throw new Error('Content type is required');
      }

      // Validate direction
      if (profileData.direction && !['push', 'pull', 'both'].includes(profileData.direction)) {
        throw new Error(`Invalid direction "${profileData.direction}"`);
      }

      // Validate conflict strategy
      if (profileData.conflictStrategy && !VALID_CONFLICT_STRATEGIES.includes(profileData.conflictStrategy)) {
        throw new Error(`Invalid conflict strategy "${profileData.conflictStrategy}"`);
      }

      // Validate field policies
      if (profileData.fieldPolicies) {
        for (const fp of profileData.fieldPolicies) {
          if (!fp.field) {
            throw new Error('Each field policy must have a field name');
          }
          if (fp.direction && !VALID_DIRECTIONS.includes(fp.direction)) {
            throw new Error(`Invalid direction "${fp.direction}" for field "${fp.field}"`);
          }
        }
      }

      const newProfile = {
        id: generateId(),
        name: profileData.name,
        contentType: profileData.contentType,
        direction: profileData.direction || 'both',
        conflictStrategy: profileData.conflictStrategy || 'latest',
        isActive: profileData.isActive || false,
        isSimple: profileData.isSimple !== false, // Default to simple mode
        fieldPolicies: (profileData.fieldPolicies || []).map((fp) => ({
          field: fp.field,
          direction: fp.direction || 'both',
        })),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // If this profile is set as active, deactivate others for same content type
      if (newProfile.isActive) {
        profiles.forEach((p) => {
          if (p.contentType === newProfile.contentType) {
            p.isActive = false;
          }
        });
      }

      profiles.push(newProfile);
      await store.set({ key: STORE_KEY, value: profiles });

      return newProfile;
    },

    /**
     * Update an existing sync profile
     */
    async updateProfile(id, updates) {
      const store = getStore();
      const profiles = await this.getProfiles();
      const index = profiles.findIndex((p) => p.id === id);

      if (index === -1) {
        throw new Error(`Profile with id "${id}" not found`);
      }

      // Validate direction
      if (updates.direction && !['push', 'pull', 'both'].includes(updates.direction)) {
        throw new Error(`Invalid direction "${updates.direction}"`);
      }

      // Validate conflict strategy
      if (updates.conflictStrategy && !VALID_CONFLICT_STRATEGIES.includes(updates.conflictStrategy)) {
        throw new Error(`Invalid conflict strategy "${updates.conflictStrategy}"`);
      }

      // Validate field policies if provided
      if (updates.fieldPolicies) {
        for (const fp of updates.fieldPolicies) {
          if (!fp.field) {
            throw new Error('Each field policy must have a field name');
          }
          if (fp.direction && !VALID_DIRECTIONS.includes(fp.direction)) {
            throw new Error(`Invalid direction "${fp.direction}" for field "${fp.field}"`);
          }
        }
      }

      // If setting this profile as active, deactivate others for same content type
      if (updates.isActive) {
        const contentType = updates.contentType || profiles[index].contentType;
        profiles.forEach((p) => {
          if (p.contentType === contentType && p.id !== id) {
            p.isActive = false;
          }
        });
      }

      const updatedProfile = {
        ...profiles[index],
        ...updates,
        id: profiles[index].id, // prevent id change
        createdAt: profiles[index].createdAt, // preserve creation date
        updatedAt: new Date().toISOString(),
      };

      if (updates.fieldPolicies) {
        updatedProfile.fieldPolicies = updates.fieldPolicies.map((fp) => ({
          field: fp.field,
          direction: fp.direction || 'both',
        }));
      }

      profiles[index] = updatedProfile;
      await store.set({ key: STORE_KEY, value: profiles });

      return updatedProfile;
    },

    /**
     * Delete a sync profile
     */
    async deleteProfile(id) {
      const store = getStore();
      const profiles = await this.getProfiles();
      const filtered = profiles.filter((p) => p.id !== id);

      if (filtered.length === profiles.length) {
        throw new Error(`Profile with id "${id}" not found`);
      }

      await store.set({ key: STORE_KEY, value: filtered });
      return { success: true };
    },

    /**
     * Create a simple preset profile
     */
    async createSimpleProfile(contentTypeUid, preset) {
      const contentType = strapi.contentTypes[contentTypeUid];
      const displayName = contentType?.info?.displayName || contentTypeUid;

      const presets = {
        full_push: {
          name: `${displayName} - Full Push`,
          direction: 'push',
          conflictStrategy: 'local_wins',
        },
        full_pull: {
          name: `${displayName} - Full Pull`,
          direction: 'pull',
          conflictStrategy: 'remote_wins',
        },
        bidirectional: {
          name: `${displayName} - Bidirectional`,
          direction: 'both',
          conflictStrategy: 'latest',
        },
      };

      const presetConfig = presets[preset];
      if (!presetConfig) {
        throw new Error(`Invalid preset "${preset}". Valid presets: ${Object.keys(presets).join(', ')}`);
      }

      return this.createProfile({
        ...presetConfig,
        contentType: contentTypeUid,
        isSimple: true,
        isActive: false,
        fieldPolicies: [],
      });
    },

    /**
     * Get field policies for a content type (from active profile)
     * Returns a map: { fieldName: 'push' | 'pull' | 'both' | 'none' }
     */
    async getFieldPoliciesForContentType(contentTypeUid) {
      const activeProfile = await this.getActiveProfileForContentType(contentTypeUid);
      if (!activeProfile || activeProfile.isSimple) {
        return null; // No field policies for simple profiles
      }

      const policyMap = {};
      for (const fp of activeProfile.fieldPolicies) {
        policyMap[fp.field] = fp.direction;
      }
      return policyMap;
    },

    /**
     * Get sync configuration for a content type (from active profile)
     */
    async getSyncConfigForContentType(contentTypeUid) {
      const activeProfile = await this.getActiveProfileForContentType(contentTypeUid);
      if (!activeProfile) {
        return null;
      }

      return {
        direction: activeProfile.direction,
        conflictStrategy: activeProfile.conflictStrategy,
        fieldPolicies: activeProfile.isSimple ? null : await this.getFieldPoliciesForContentType(contentTypeUid),
      };
    },

    /**
     * Filter fields based on policies for a given direction
     */
    filterFieldsByPolicy(record, fieldPolicies, syncDirection) {
      if (!fieldPolicies) {
        return record; // No policies, return all fields
      }

      const filtered = {};
      for (const [field, value] of Object.entries(record)) {
        const policy = fieldPolicies[field];

        // If no policy defined for field, include it (default to 'both')
        if (!policy || policy === 'both') {
          filtered[field] = value;
          continue;
        }

        // Include field if policy matches sync direction
        if (policy === syncDirection) {
          filtered[field] = value;
          continue;
        }

        // Always include id and metadata fields
        if (['id', 'documentId', 'syncId', 'createdAt', 'updatedAt'].includes(field)) {
          filtered[field] = value;
        }
      }

      return filtered;
    },
  };
};
