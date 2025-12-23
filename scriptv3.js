// ====================================
// CONFIGURATION
// ====================================
const SUPABASE_URL = 'https://lnoixeskupzydjjpbvyu.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxub2l4ZXNrdXB6eWRqanBidnl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjIwMTI3MDksImV4cCI6MjA3NzU4ODcwOX0.a4yw5e_ojAmcdpWWlc8zXXehnjATOfRnVxC22f8tang';
const GOOGLE_CALENDAR_ID = 'd392dc35dbd1a2f8807f396fcc095f16fe662aaabce1ac6df94e2100aae3378c@group.calendar.google.com';
const GOOGLE_CALENDAR_API_KEY = 'AIzaSyCU8sdOOUT5LP145Doy7R7MGlJmgtOs3Ls';

// Initialize Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        storageKey: 'dom-collective-auth',
        storage: window.localStorage,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
    }
});
// ====================================
// MAIN APPLICATION CLASS
// ====================================
class CreativeCollective {
    constructor() {
        this.currentUser = null;
        this.members = [];
        this.needs = [];
        this.events = [];
        this.messages = [];
        this.isLoginMode = true;
        this.onboardingStep = 1;
        this.contactRecipient = null;
        this._isSubmittingNeed = false;
        this._lastSubmitTime = 0;
        this.currentGallery = [];
        this.currentGalleryIndex = 0;
        this.checkInStatuses = [];
        this.currentCheckInFilter = 'all';
        
        console.log('CreativeCollective constructor completed');
    }

    // ====================================
    // INITIALIZATION
    // ====================================
    async init() {
        console.log('Initializing DōM Collective...');
        
        try {
            // Bind all events first
            console.log('Binding events...');
            this.bindEvents();
            console.log('✓ Events bound');
            
            // Check for existing session (this can take time)
            console.log('Checking for existing session...');
            await this.checkSession(); // MUST await for OAuth to work
            console.log('✓ Session checked');
            
            // Load initial data - render UI immediately, update when data arrives
            console.log('Loading data...');
            
            // Show loading states immediately
            const memberCount = document.getElementById('memberCount');
            const needsCount = document.getElementById('needsCount');
            const eventsCount = document.getElementById('eventsCount');
            if (memberCount) memberCount.textContent = '...';
            if (needsCount) needsCount.textContent = '...';
            if (eventsCount) eventsCount.textContent = '...';
            
            // Load data is now handled in checkSession
            // Don't duplicate loading here
            
            console.log('✓ Data loading initiated');
            
            console.log('=== App initialized successfully ===');
        } catch (error) {
            console.error('=== INITIALIZATION FAILED ===');
            console.error('Error:', error);
            console.error('Stack:', error.stack);
            this.showAlert('Failed to initialize app. Please refresh the page.', 'error');
        }
    }

    // ====================================
    // AUTHENTICATION
    // ====================================
    async checkSession() {
        console.log('Getting session from Supabase...');
        
        try {
            // Add timeout to prevent infinite hang
            const sessionPromise = supabase.auth.getSession();
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Session check timeout')), 10000)
            );
            
            const { data: { session }, error } = await Promise.race([sessionPromise, timeoutPromise]);
            
            console.log('Session result:', session ? session.user.email : 'No session', error ? error.message : 'No error');
            
            if (error) {
                console.error('Session error:', error);
                this.updateAuthButton();
                await this.loadDataWithoutAuth();
                return;
            }
            
            if (session && session.user) {
                console.log('✅ Session exists, handling auth success...');
                await this.handleAuthSuccess(session);
            } else {
                console.log('No active session');
                this.updateAuthButton();
                await this.loadDataWithoutAuth();
            }
        } catch (err) {
            console.error('Session check failed:', err);
            this.updateAuthButton();
            await this.loadDataWithoutAuth();
        }
        
        // Listen for auth state changes
        supabase.auth.onAuthStateChange(async (event, session) => {
            console.log('Auth state changed:', event, session?.user?.email || 'No user');
            
            if (event === 'SIGNED_IN' && session) {
                console.log('User signed in via state change');
                await this.handleAuthSuccess(session);
            } else if (event === 'SIGNED_OUT') {
                this.handleSignOut();
            }
        });
    }

    async loadDataWithoutAuth() {
        await this.loadMembers();
        await this.loadMissions();
        await this.loadEvents();
        await this.loadCheckInStatuses();
        await this.updateStats();
        this.renderFeaturedMembers();
        this.renderLatestNeeds();
        await this.renderUpcomingEventsHome();
    }

    async handleAuthSuccess(session) {
        console.log('handleAuthSuccess called with session:', session.user.email);
        
        try {
            // Check if profile exists
            const { data: profile, error: profileError } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', session.user.id)
                .maybeSingle();

            console.log('Profile query result:', { profile, profileError });

            if (!profile) {
                // Profile doesn't exist, create it
                console.log('No profile found, creating new one...');
                await this.createNewProfile(session.user);
            } else if (profileError) {
                // Some other error
                console.error('Profile query error:', profileError);
                throw profileError;
            } else {
                console.log('Profile found, loading...');
                
                // CRITICAL: Set currentUser immediately with the profile data
                this.currentUser = {
                    id: profile.id,
                    name: profile.name,
                    email: profile.email,
                    bio: profile.bio || '',
                    skills: profile.skills || [],
                    website: profile.website || '',
                    portfolio: profile.portfolio || '',
                    social: profile.social || '',
                    contact: profile.contact || profile.email,
                    avatar: profile.avatar || '',
                    user_status: profile.user_status || 'unverified',
                    projects: profile.projects || [],
                    profile_gallery: profile.profile_gallery || []
                };
                
                console.log('✓ currentUser set:', this.currentUser.name, 'Status:', this.currentUser.user_status);
                
                await this.loadMembers();
                
                // FORCE UI UPDATE with null checks for mobile
                setTimeout(() => {
                    this.updateAuthButton();
                    const profileBtn = document.getElementById('profileNavBtn');
                    if (profileBtn) {
                        profileBtn.style.display = 'block';
                        console.log('✓ Profile nav button displayed');
                    }
                    const checkInBtn = document.getElementById('checkInNavBtn');
                    if (checkInBtn && this.currentUser && this.currentUser.user_status !== 'unverified') {
                        checkInBtn.style.display = 'block';
                        console.log('✓ Check-in nav button displayed');
                    }
                }, 100);
                
                // Check if profile needs completion
                if (!profile.bio || !profile.skills || profile.skills.length === 0) {
                    this.showSection('profile');
                    this.showAlert('Please complete your profile!', 'success');
                    setTimeout(() => this.showOnboarding(), 500);
                } else {
                    this.showSection('home');
                    this.showAlert(`Welcome back, ${profile.name}!`, 'success');
                }
            }
        } catch (error) {
            console.error('Auth success handler error:', error);
            this.showAlert('Error loading profile: ' + error.message, 'error');
        }
    }

    async createNewProfile(user) {
        console.log('Creating new profile for:', user.email);
        
        const userName = user.user_metadata.full_name || 
                        user.user_metadata.name || 
                        user.email.split('@')[0];
        
        console.log('Profile name will be:', userName);
        
        try {
            const { data, error } = await supabase.from('profiles').insert([{
                id: user.id,
                email: user.email,
                name: userName,
                user_status: 'unverified',
                bio: '',
                skills: [],
                created_at: new Date().toISOString()
            }]).select();

            if (error) {
                console.error('Profile creation error:', error);
                throw error;
            }

            console.log('Profile created successfully:', data);

            await this.loadUserProfile(user.id);
            await this.loadMembers();
            this.updateAuthButton();
            document.getElementById('profileNavBtn').style.display = 'block';
            const checkInBtn = document.getElementById('checkInNavBtn');
            if (checkInBtn && this.currentUser.user_status !== 'unverified') {
                checkInBtn.style.display = 'block';
            }
            
            this.showSection('profile');
            this.showAlert('Welcome! Please complete your profile.', 'success');
            setTimeout(() => this.showOnboarding(), 500);
        } catch (error) {
            console.error('Create profile failed:', error);
            throw error;
        }
    }

    handleSignOut() {
        this.currentUser = null;
        this.updateAuthButton();
        document.getElementById('profileNavBtn').style.display = 'none';
            document.getElementById('checkInNavBtn').style.display = 'none';
        
        if (document.getElementById('profile')?.classList.contains('active')) {
            this.showSection('home');
        }
        
        this.showAlert('Logged out successfully', 'success');
    }

    async signInWithGoogle() {
        try {
            console.log('Initiating Google sign-in...');
            
            // Use PKCE flow for better mobile support
            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: `${window.location.origin}/`,
                    queryParams: {
                        access_type: 'offline',
                        prompt: 'consent'
                    },
                    skipBrowserRedirect: false
                }
            });

            if (error) throw error;
            console.log('Google OAuth initiated:', data);
        } catch (error) {
            console.error('Google sign-in error:', error);
            this.showAlert('Failed to sign in with Google: ' + error.message, 'error');
        }
    }

    async handleAuth(e) {
        e.preventDefault();
        
        const email = document.getElementById('authEmail').value;
        const password = document.getElementById('authPassword').value;
        const name = document.getElementById('authName').value;

        if (this.isLoginMode) {
            await this.login(email, password);
        } else {
            await this.signup(email, password, name);
        }
    }

    async login(email, password) {
        try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });

            if (error) throw error;

            // Load the profile which sets currentUser
            const { data: profile } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', data.user.id)
                .single();

            if (profile) {
                this.currentUser = {
                    id: profile.id,
                    name: profile.name,
                    email: profile.email,
                    bio: profile.bio || '',
                    skills: profile.skills || [],
                    website: profile.website || '',
                    portfolio: profile.portfolio || '',
                    social: profile.social || '',
                    contact: profile.contact || profile.email,
                    avatar: profile.avatar || '',
                    user_status: profile.user_status || 'unverified',
                    projects: profile.projects || []
                };
                
                console.log('✓ Login successful, currentUser set:', this.currentUser.name);
            }

            this.closeModal(document.getElementById('authModal'));
            this.updateAuthButton();
            document.getElementById('profileNavBtn').style.display = 'block';
            const checkInBtn = document.getElementById('checkInNavBtn');
            if (checkInBtn && this.currentUser.user_status !== 'unverified') {
                checkInBtn.style.display = 'block';
            }
            this.showAlert(`Welcome back, ${this.currentUser.name}!`, 'success');
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    async signup(email, password, name) {
        if (!name) {
            this.showAlert('Name is required for sign up', 'error');
            return;
        }

        try {
            const { data: authData, error: authError } = await supabase.auth.signUp({
                email,
                password
            });

            if (authError) throw authError;

            const { error: profileError } = await supabase
                .from('profiles')
                .insert([{
                    id: authData.user.id,
                    email: email,
                    name: name,
                    user_status: 'unverified',
                    bio: '',
                    skills: [],
                    created_at: new Date().toISOString()
                }]);

            if (profileError) throw profileError;

            await this.loadUserProfile(authData.user.id);
            this.closeModal(document.getElementById('authModal'));
            this.updateAuthButton();
            document.getElementById('profileNavBtn').style.display = 'block';
            const checkInBtn = document.getElementById('checkInNavBtn');
            if (checkInBtn && this.currentUser.user_status !== 'unverified') {
                checkInBtn.style.display = 'block';
            }
            this.showAlert('Account created! Please complete your profile.', 'success');
            this.showOnboarding();
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    async logout() {
        try {
            const { error } = await supabase.auth.signOut();
            if (error) throw error;

            this.handleSignOut();
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    toggleAuthMode() {
        this.isLoginMode = !this.isLoginMode;
        
        const title = document.getElementById('authModalTitle');
        const submitBtn = document.getElementById('authSubmit');
        const nameGroup = document.getElementById('authNameGroup');
        const toggleText = document.getElementById('authToggleText');
        const toggleLink = document.getElementById('authToggleLink');

        if (this.isLoginMode) {
            title.textContent = 'Login';
            submitBtn.textContent = 'Login';
            nameGroup.style.display = 'none';
            toggleText.textContent = "Don't have an account?";
            toggleLink.textContent = 'Sign up';
        } else {
            title.textContent = 'Sign Up';
            submitBtn.textContent = 'Sign Up';
            nameGroup.style.display = 'block';
            toggleText.textContent = 'Already have an account?';
            toggleLink.textContent = 'Login';
        }
    }

    updateAuthButton() {
        const authBtn = document.getElementById('authBtn');
        const profileNavBtn = document.getElementById('profileNavBtn');
        const createEventBtn = document.getElementById('createEventBtn');
        
        if (this.currentUser) {
            authBtn.textContent = 'Logout';
            profileNavBtn.style.display = 'block';
            
            // Show create event button only for admins
            if (createEventBtn && this.currentUser.user_status === 'admin') {
                createEventBtn.style.display = 'block';
            } else if (createEventBtn) {
                createEventBtn.style.display = 'none';
            }
        } else {
            authBtn.textContent = 'Login';
            profileNavBtn.style.display = 'none';
            if (createEventBtn) {
                createEventBtn.style.display = 'none';
            }
        }
    }

    // ====================================
    // USER PROFILE MANAGEMENT
    // ====================================
    async loadUserProfile(userId) {
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', userId)
                .single();

            if (error) throw error;

            this.currentUser = {
                id: data.id,
                name: data.name,
                email: data.email,
                bio: data.bio || '',
                skills: data.skills || [],
                website: data.website || '',
                portfolio: data.portfolio || '',
                social: data.social || '',
                contact: data.contact || data.email,
                avatar: data.avatar || '',
                user_status: data.user_status || 'unverified',
                projects: data.projects || [],
                profile_gallery: data.profile_gallery || []
            };

            console.log('User profile loaded:', this.currentUser.name);
        } catch (error) {
            console.error('Load profile error:', error);
        }
    }

    async saveProfile(e) {
        e.preventDefault();
        if (!this.currentUser) return;

        const profileData = {
            name: document.getElementById('profileName').value,
            bio: document.getElementById('profileBio').value,
            skills: document.getElementById('profileSkills').value
                .split(',')
                .map(s => s.trim())
                .filter(s => s),
            website: document.getElementById('profileWebsite').value,
            portfolio: document.getElementById('profilePortfolio').value,
            social: document.getElementById('profileSocial').value,
            contact: document.getElementById('profileContact').value,
            avatar: document.getElementById('profileAvatar').value,
            projects: this.currentUser.projects || []
        };

        try {
            const { error } = await supabase
                .from('profiles')
                .update(profileData)
                .eq('id', this.currentUser.id);

            if (error) throw error;

            Object.assign(this.currentUser, profileData);
            
            this.showAlert('Profile saved successfully!', 'success');
            
            // Refresh data
            await this.loadMembers();
            this.updateStats();
            this.populateSkillFilters();
            this.renderFeaturedMembers();
            
            if (document.getElementById('directory').classList.contains('active')) {
                this.renderMembers();
            }
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    loadUserProfileForm() {
        if (!this.currentUser) {
            this.showAlert('Please login to view your profile', 'error');
            this.showAuthModal();
            return;
        }

        console.log('Loading profile form for user:', this.currentUser.name);

        // Update status banner
        const statusBanner = document.getElementById('userStatusBanner');
        const statusText = document.getElementById('statusText');
        
        if (statusBanner && statusText) {
            const statusConfig = {
                'unverified': { text: '⚠️ Unverified Account - Limited Access', bg: '#fff', color: '#000' },
                'verified': { text: '✓ Verified Member', bg: '#000', color: '#fff' },
                'admin': { text: '★ Administrator', bg: '#000', color: '#fff' }
            };
            
            const config = statusConfig[this.currentUser.user_status] || statusConfig['unverified'];
            statusText.textContent = config.text;
            statusBanner.style.background = config.bg;
            statusBanner.style.color = config.color;
        }

        // Load form data
        document.getElementById('profileName').value = this.currentUser.name || '';
        document.getElementById('profileBio').value = this.currentUser.bio || '';
        document.getElementById('profileSkills').value = this.currentUser.skills?.join(', ') || '';
        document.getElementById('profileWebsite').value = this.currentUser.website || '';
        document.getElementById('profilePortfolio').value = this.currentUser.portfolio || '';
        document.getElementById('profileSocial').value = this.currentUser.social || '';
        document.getElementById('profileContact').value = this.currentUser.contact || '';
        document.getElementById('profileAvatar').value = this.currentUser.avatar || '';
        
        this.renderUserProjects();
        this.updateProfilePreview();
        this.updateAvatarPreview();
        this.renderProfilePhotos();
    }

    updateProfilePreview() {
        const name = document.getElementById('profileName').value || 'Your Name';
        const bio = document.getElementById('profileBio').value || 'Your bio will appear here...';
        const skillsText = document.getElementById('profileSkills').value;
        const portfolio = document.getElementById('profilePortfolio').value;

        document.getElementById('previewName').textContent = name;
        document.getElementById('previewBio').textContent = bio;

        // Update skills
        const skillsContainer = document.getElementById('previewSkills');
        skillsContainer.innerHTML = '';
        if (skillsText) {
            const skills = skillsText.split(',').map(s => s.trim()).filter(s => s);
            skills.forEach(skill => {
                const tag = document.createElement('span');
                tag.className = 'skill-tag';
                tag.textContent = skill;
                skillsContainer.appendChild(tag);
            });
        }

        // Update portfolio link
        const portfolioLink = document.getElementById('previewPortfolioLink');
        if (portfolio) {
            portfolioLink.href = portfolio;
            portfolioLink.style.display = 'inline-block';
        } else {
            portfolioLink.style.display = 'none';
        }

        // Update projects preview
        if (this.currentUser && this.currentUser.projects) {
            const projectsContainer = document.getElementById('previewProjects');
            if (this.currentUser.projects.length > 0) {
                projectsContainer.innerHTML = this.currentUser.projects.map(project => `
                    <div class="portfolio-project" style="margin-top: 1rem;">
                        ${project.image ? `<img src="${project.image}" alt="${project.title}" class="project-image-small">` : ''}
                        <h4 style="font-size: 1rem;">${project.title}</h4>
                        <p style="font-size: 0.9rem;">${project.description}</p>
                    </div>
                `).join('');
            } else {
                projectsContainer.innerHTML = '<p style="font-size: 0.9rem; font-style: italic;">No projects yet</p>';
            }
        }
    }

    updateAvatarPreview() {
        const avatarUrl = document.getElementById('profileAvatar').value;
        const preview = document.getElementById('avatarPreview');
        const previewAvatar = document.getElementById('previewAvatar');
        
        if (avatarUrl) {
            preview.innerHTML = `<img src="${avatarUrl}" alt="Avatar preview">`;
            previewAvatar.innerHTML = `<img src="${avatarUrl}" alt="Avatar">`;
        } else {
            preview.innerHTML = '';
            previewAvatar.innerHTML = '<div class="avatar-placeholder">Photo</div>';
        }
    }

    addSkillToInput(skill) {
        const input = document.getElementById('profileSkills');
        const currentSkills = input.value ? input.value.split(',').map(s => s.trim()) : [];
        
        if (!currentSkills.includes(skill)) {
            currentSkills.push(skill);
            input.value = currentSkills.join(', ');
            this.updateProfilePreview();
        }
    }

    // ====================================
    // ONBOARDING
    // ====================================
    showOnboarding() {
        if (this.currentUser && this.currentUser.name) {
            document.getElementById('onboardName').value = this.currentUser.name;
        }
        
        document.getElementById('onboardingModal').classList.add('active');
        this.onboardingStep = 1;
        this.showOnboardingStep(1);
    }

    showOnboardingStep(step) {
        document.querySelectorAll('.onboarding-step').forEach(s => s.classList.remove('active'));
        document.querySelector(`[data-step="${step}"]`).classList.add('active');
        this.onboardingStep = step;
    }

    nextOnboardingStep() {
        if (this.onboardingStep === 1) {
            const name = document.getElementById('onboardName').value;
            const bio = document.getElementById('onboardBio').value;
            if (!name || !bio) {
                this.showAlert('Please fill in all required fields', 'error');
                return;
            }
        }

        if (this.onboardingStep < 3) {
            this.showOnboardingStep(this.onboardingStep + 1);
        }
    }

    prevOnboardingStep() {
        if (this.onboardingStep > 1) {
            this.showOnboardingStep(this.onboardingStep - 1);
        }
    }

    async completeOnboarding(e) {
        e.preventDefault();
        if (!this.currentUser) return;

        // Collect skills
        const selectedSkills = Array.from(document.querySelectorAll('.skill-checkbox input:checked'))
            .map(cb => cb.value);
        
        const otherSkills = document.getElementById('onboardOtherSkills').value
            .split(',')
            .map(s => s.trim())
            .filter(s => s);
        
        const allSkills = [...selectedSkills, ...otherSkills];

        const profileData = {
            name: document.getElementById('onboardName').value,
            bio: document.getElementById('onboardBio').value,
            skills: allSkills,
            portfolio: document.getElementById('onboardPortfolio').value,
            website: document.getElementById('onboardWebsite').value,
            social: document.getElementById('onboardSocial').value
        };

        try {
            const { error } = await supabase
                .from('profiles')
                .update(profileData)
                .eq('id', this.currentUser.id);

            if (error) throw error;

            Object.assign(this.currentUser, profileData);
            
            this.closeModal(document.getElementById('onboardingModal'));
            this.showAlert('Profile completed! Welcome to DōM!', 'success');
            
            await this.loadMembers();
            this.renderFeaturedMembers();
            this.loadUserProfileForm();
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    // ====================================
    // DATA LOADING
    // ====================================
    async loadMembers() {
        try {
            console.log('Loading members from database...');
            
            const { data, error } = await supabase
                .from('profiles')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }

            console.log('Raw data from Supabase:', data);

            this.members = data.map(m => ({
                id: m.id,
                name: m.name,
                email: m.email,
                bio: m.bio || '',
                skills: m.skills || [],
                website: m.website || '',
                portfolio: m.portfolio || '',
                social: m.social || '',
                contact: m.contact || m.email,
                avatar: m.avatar || '',
                user_status: m.user_status || 'unverified',
                projects: m.projects || [],
                joinDate: new Date(m.created_at)
            }));

            this.updateStats();
            console.log('✓ Loaded', this.members.length, 'members');
        } catch (error) {
            console.error('❌ Load members error:', error);
            console.error('Error details:', error.message, error.code, error.details);
            this.members = [];
        }
    }
    async loadMissions() {
        try {
            console.log('Loading missions from database...');
            
            const { data, error } = await supabase
                .from('missions')
                .select('*')
                .eq('status', 'open')
                .order('posted_date', { ascending: false });

            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }

            console.log('Raw missions data:', data);

            this.needs = data.map(n => ({
                id: n.id,
                title: n.title,
                description: n.description,
                skills: n.skills || [],
                budget: n.budget || 'Budget not specified',
                authorId: n.author_id,
                postedDate: new Date(n.posted_date),
                status: n.status,
                deadline: n.deadline
            }));

            this.updateStats();
            console.log('✓ Loaded', this.needs.length, 'needs');
        } catch (error) {
            console.error('❌ Load missions error:', error);
            console.error('Error details:', error.message, error.code, error.details);
            this.needs = [];
        }
    }
    async loadEvents() {
        try {
            console.log('Loading events from database...');
            
            const { data, error } = await supabase
                .from('events')
                .select('*')
                .order('date', { ascending: true });

            if (error) {
                console.error('Supabase error:', error);
                throw error;
            }

            console.log('Raw events data:', data);

            this.events = data.map(e => ({
                id: e.id,
                title: e.title,
                description: e.description || '',
                date: new Date(e.date),
                time: e.time || '',
                location: e.location || '',
                type: e.type || 'Other',
                organizerId: e.organizer_id
            }));

            this.updateStats();
            console.log('✓ Loaded', this.events.length, 'events');
        } catch (error) {
            console.error('❌ Load events error:', error);
            console.error('Error details:', error.message, error.code, error.details);
            this.events = [];
        }
    }

    async fetchGoogleCalendarEvents() {
        console.log('Fetching Google Calendar events...');
        
        const now = new Date();
        const nextWeek = new Date();
        nextWeek.setDate(now.getDate() + 7);
        
        const timeMin = now.toISOString();
        const timeMax = nextWeek.toISOString();
        
        console.log('Time range:', { timeMin, timeMax });
        
        try {
            const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(GOOGLE_CALENDAR_ID)}/events?key=${GOOGLE_CALENDAR_API_KEY}&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime&maxResults=10`;
            
            console.log('Fetching from URL (key hidden):', url.replace(GOOGLE_CALENDAR_API_KEY, 'HIDDEN'));
            
            const response = await fetch(url);
            
            console.log('Calendar API response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Calendar API error:', errorText);
                throw new Error(`Failed to fetch calendar events: ${response.status}`);
            }
            
            const data = await response.json();
            console.log('Calendar API success - Events found:', data.items?.length || 0);
            
            if (data.items && data.items.length > 0) {
                console.log('First event:', data.items[0]);
            }
            
            return data.items || [];
        } catch (error) {
            console.error('Google Calendar API error:', error);
            return [];
        }
    }

    // ====================================
    // PROJECTS
    // ====================================
    renderUserProjects() {
        if (!this.currentUser || !this.currentUser.projects) return;

        const container = document.getElementById('portfolioProjects');
        
        if (this.currentUser.projects.length === 0) {
            container.innerHTML = '<p class="empty-state">Add projects to showcase your work</p>';
            return;
        }

        container.innerHTML = this.currentUser.projects.map((project, index) => `
            <div class="portfolio-project">
                ${project.image ? `<img src="${project.image}" alt="${project.title}" class="project-image">` : ''}
                <h4>${project.title}</h4>
                <p>${project.description}</p>
                <div class="project-actions">
                    ${project.link ? `<a href="${project.link}" target="_blank" class="btn btn-outline">View Project</a>` : ''}
                    <button class="btn btn-outline" onclick="app.deleteProject(${index})">Remove</button>
                </div>
            </div>
        `).join('');
    }

    async addProject(e) {
        e.preventDefault();
        if (!this.currentUser) return;

        const project = {
            title: document.getElementById('projectTitle').value,
            description: document.getElementById('projectDescription').value,
            image: document.getElementById('projectImage').value,
            link: document.getElementById('projectLink').value
        };

        if (!this.currentUser.projects) {
            this.currentUser.projects = [];
        }

        this.currentUser.projects.push(project);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ projects: this.currentUser.projects })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            this.closeModal(document.getElementById('projectModal'));
            this.renderUserProjects();
            this.updateProfilePreview();
            this.showAlert('Project added successfully!', 'success');
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    async deleteProject(index) {
        if (!this.currentUser || !this.currentUser.projects) return;
        
        this.currentUser.projects.splice(index, 1);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ projects: this.currentUser.projects })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            this.renderUserProjects();
            this.updateProfilePreview();
            this.showAlert('Project removed', 'success');
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    updateProjectImagePreview() {
        const imageUrl = document.getElementById('projectImage').value;
        const preview = document.getElementById('projectImagePreview');
        
        if (imageUrl) {
            preview.innerHTML = `<img src="${imageUrl}" alt="Project preview">`;
        } else {
            preview.innerHTML = '';
        }
    }

    showProjectModal() {
        if (!this.currentUser) {
            this.showAlert('Please login to add projects', 'error');
            return;
        }
        document.getElementById('projectModal').classList.add('active');
    }
    async handleProfilePhotos(e) {
        if (!this.currentUser) {
            this.showAlert('Please login first', 'error');
            return;
        }

        const files = Array.from(e.target.files);
        if (files.length === 0) return;

        const statusEl = document.getElementById('avatarUploadStatus');
        statusEl.textContent = 'Uploading...';

        const uploadedUrls = [];

        for (const file of files) {
            if (!file.type.startsWith('image/')) continue;
            if (file.size > 5 * 1024 * 1024) {
                this.showAlert('Skipped file over 5MB: ' + file.name, 'error');
                continue;
            }

            try {
                const fileExt = file.name.split('.').pop();
                const fileName = `${this.currentUser.id}/photo-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;

                const { error } = await supabase.storage
                    .from('profile-galleries')
                    .upload(fileName, file, {
                        cacheControl: '3600',
                        upsert: false
                    });

                if (error) throw error;

                const { data: { publicUrl } } = supabase.storage
                    .from('profile-galleries')
                    .getPublicUrl(fileName);

                uploadedUrls.push(publicUrl);
            } catch (error) {
                console.error('Upload error:', error);
                statusEl.textContent = 'Error uploading: ' + error.message;
            }
        }

        if (uploadedUrls.length > 0) {
            // Add to existing gallery
            if (!this.currentUser.profile_gallery) {
                this.currentUser.profile_gallery = [];
            }
            this.currentUser.profile_gallery = [...this.currentUser.profile_gallery, ...uploadedUrls];

            // First photo is always the avatar/cover
            const coverPhoto = this.currentUser.profile_gallery[0];
            this.currentUser.avatar = coverPhoto;
            document.getElementById('profileAvatar').value = coverPhoto;

            try {
                const { error } = await supabase
                    .from('profiles')
                    .update({ 
                        profile_gallery: this.currentUser.profile_gallery,
                        avatar: coverPhoto
                    })
                    .eq('id', this.currentUser.id);

                if (error) throw error;

                statusEl.textContent = `✓ Added ${uploadedUrls.length} photo(s)`;
                setTimeout(() => { statusEl.textContent = ''; }, 3000);
                
                this.renderProfilePhotos();
                this.updateAvatarPreview();
            } catch (error) {
                this.showAlert('Error saving photos: ' + error.message, 'error');
            }
        }

        // Clear input
        e.target.value = '';
    }

    async removeProfilePhoto(index) {
        if (!this.currentUser || !this.currentUser.profile_gallery) return;
        
        if (!confirm('Remove this photo?')) return;

        this.currentUser.profile_gallery.splice(index, 1);

        // Update avatar to first remaining photo or empty
        const newAvatar = this.currentUser.profile_gallery[0] || '';
        this.currentUser.avatar = newAvatar;
        document.getElementById('profileAvatar').value = newAvatar;

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ 
                    profile_gallery: this.currentUser.profile_gallery,
                    avatar: newAvatar
                })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            this.showAlert('Photo removed', 'success');
            this.renderProfilePhotos();
            this.updateAvatarPreview();
        } catch (error) {
            this.showAlert('Error removing photo: ' + error.message, 'error');
        }
    }

    renderProfilePhotos() {
        const container = document.getElementById('profilePhotosGrid');
        if (!container) return;

        const photos = this.currentUser?.profile_gallery || [];

        let html = photos.map((url, index) => `
            <div class="profile-photo-item ${index === 0 ? 'cover-photo' : ''}">
                ${index === 0 ? '<span class="photo-badge">Cover</span>' : ''}
                <button class="photo-remove" onclick="app.removeProfilePhoto(${index})">×</button>
                <img src="${url}" alt="Photo ${index + 1}">
            </div>
        `).join('');

        html += `
            <div class="photo-add-btn" onclick="document.getElementById('profilePhotosInput').click()">
                <span>+</span>
                <small>Add Photos</small>
            </div>
        `;

        container.innerHTML = html;
    }

async uploadProjectImage() {
    if (!this.currentUser) {
        this.showAlert('Please login first', 'error');
        return;
    }

    const fileInput = document.getElementById('projectImageFile');
    const file = fileInput.files[0];
    
    if (!file) {
        this.showAlert('Please select a file first', 'error');
        return;
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
        this.showAlert('Please select an image file', 'error');
        return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
        this.showAlert('Image must be less than 5MB', 'error');
        return;
    }

    const statusEl = document.getElementById('projectImageUploadStatus');
    const uploadBtn = document.getElementById('uploadProjectImageBtn');
    
    try {
        statusEl.textContent = 'Uploading...';
        uploadBtn.disabled = true;

        // Create unique filename
        const fileExt = file.name.split('.').pop();
        const fileName = `${this.currentUser.id}/project-${Date.now()}.${fileExt}`;

        // Upload to Supabase Storage
        const { data, error } = await supabase.storage
            .from('project-images')
            .upload(fileName, file, {
                cacheControl: '3600',
                upsert: true
            });

        if (error) throw error;

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
            .from('project-images')
            .getPublicUrl(fileName);

        // Update the URL input
        document.getElementById('projectImage').value = publicUrl;
        this.updateProjectImagePreview();

        statusEl.textContent = '✓ Uploaded successfully!';
        statusEl.style.color = '#000';
        
        // Clear file input
        fileInput.value = '';
        
        setTimeout(() => {
            statusEl.textContent = '';
        }, 3000);
    } catch (error) {
        console.error('Upload error:', error);
        statusEl.textContent = '✗ Upload failed: ' + error.message;
        statusEl.style.color = '#f00';
    } finally {
        uploadBtn.disabled = false;
    }
}

    // ====================================
    // NEEDS BOARD
    // ====================================
    async postMission(e) {
        e.preventDefault();
        
        // Enhanced double submission prevention
        const now = Date.now();
        if (this._isSubmittingNeed || (now - this._lastSubmitTime < 2000)) {
            console.log('Already submitting or too soon, ignoring duplicate submission');
            return;
        }
        this._lastSubmitTime = now;
        
        if (!this.currentUser) return;

        if (this.currentUser.user_status !== 'verified' && this.currentUser.user_status !== 'admin') {
            this.showAlert('Only verified members can post missions', 'error');
            return;
        }

        // Set flag to prevent double submission
        this._isSubmittingNeed = true;
        const submitBtn = document.querySelector('#needModal button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Posting...';
        }

        const missionData = {
            title: document.getElementById('needTitle').value,
            description: document.getElementById('needDescription').value,
            skills: document.getElementById('needSkills').value
                .split(',')
                .map(s => s.trim())
                .filter(s => s),
            budget: document.getElementById('needBudget').value || 'Budget not specified',
            author_id: this.currentUser.id,
            posted_date: new Date().toISOString(),
            status: 'open',
            deadline: document.getElementById('needDeadline')?.value || null
        };

        try {
            const { error } = await supabase
                .from('missions')
                .insert([missionData]);

            if (error) throw error;

            this.closeModal(document.getElementById('needModal'));
            this.showAlert('Mission posted successfully!', 'success');
            await this.loadMissions();
            
            if (document.getElementById('needs').classList.contains('active')) {
                this.renderNeeds();
            }
        } catch (error) {
            this.showAlert(error.message, 'error');
        } finally {
            // Reset submission flag with delay
            setTimeout(() => {
                this._isSubmittingNeed = false;
            }, 1000);
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Post Need';
            }
        }
    }

    async markNeedClosed(needId) {
        if (!this.currentUser) {
            this.showAlert('Please login to close needs', 'error');
            return;
        }
        
        if (!confirm('Mark this need as closed?')) {
            return;
        }
        
        try {
            const { error } = await supabase
                .from('missions')
                .update({ status: 'closed' })
                .eq('id', needId)
                .eq('author_id', this.currentUser.id);

            if (error) throw error;

            this.showAlert('Need marked as closed', 'success');
            await this.loadMissions();
            this.renderNeeds();
        } catch (error) {
            this.showAlert('Error closing need: ' + error.message, 'error');
        }
    }
    showEditNeedModal(needId) {
    if (!this.currentUser) return;
    
    const need = this.needs.find(n => n.id === needId);
    if (!need || need.authorId !== this.currentUser.id) return;
    
    // Populate form with existing data
    document.getElementById('needTitle').value = need.title;
    document.getElementById('needDescription').value = need.description;
    document.getElementById('needSkills').value = need.skills.join(', ');
    document.getElementById('needBudget').value = need.budget;
    document.getElementById('needDeadline').value = need.deadline || '';
    
    // Change form submission to update instead of create
    const form = document.getElementById('needForm');
    form.onsubmit = async (e) => {
        e.preventDefault();
        await this.updateMission(needId);
    };
    
    // Change modal title
    document.querySelector('#needModal h3').textContent = 'Edit Need';
    document.querySelector('#needModal button[type="submit"]').textContent = 'Update Need';
    
    document.getElementById('needModal').classList.add('active');
}

async updateMission(needId) {
        if (!this.currentUser) return;

        const missionData = {
            title: document.getElementById('needTitle').value,
            description: document.getElementById('needDescription').value,
            skills: document.getElementById('needSkills').value
                .split(',')
                .map(s => s.trim())
                .filter(s => s),
            budget: document.getElementById('needBudget').value || 'Budget not specified',
            deadline: document.getElementById('needDeadline')?.value || null
        };

        try {
            const { error } = await supabase
                .from('missions')
                .update(missionData)
                .eq('id', needId)
                .eq('author_id', this.currentUser.id);

            if (error) throw error;

            this.closeModal(document.getElementById('needModal'));
            this.showAlert('Need updated successfully!', 'success');
            
            // Reset form for next use
            document.getElementById('needForm').onsubmit = (e) => this.postMission(e);
            document.querySelector('#needModal h3').textContent = 'Post a Need';
            document.querySelector('#needModal button[type="submit"]').textContent = 'Post Need';
            
            await this.loadMissions();
            this.renderNeeds();
        } catch (error) {
            this.showAlert('Error updating need: ' + error.message, 'error');
        }
    }

    editNeed(needId) {
        this.showEditNeedModal(needId);
    }
    showNeedModal() {
        console.log('=== showNeedModal DEBUG ===');
        console.log('currentUser:', this.currentUser);
        console.log('currentUser exists?', !!this.currentUser);
        
        // Reset submission protection
        this._isSubmittingNeed = false;
        this._lastSubmitTime = 0;
        
        if (!this.currentUser) {
            console.log('❌ No currentUser - showing auth modal');
            this.showAlert('Please login to post a need', 'error');
            this.showAuthModal();
            return;
        }
        
        console.log('✓ User found:', this.currentUser.name);
        console.log('✓ User status:', this.currentUser.user_status);
        console.log('✓ User ID:', this.currentUser.id);
        
        if (this.currentUser.user_status !== 'verified' && this.currentUser.user_status !== 'admin') {
            console.log('❌ User not verified/admin');
            this.showAlert('Only verified members can post needs. Please contact an admin for verification.', 'error');
            return;
        }
        
        console.log('✓ All checks passed - opening modal');
        
        // Reset form for new post
        document.getElementById('needForm').reset();
        document.getElementById('needForm').onsubmit = (e) => this.postMission(e);
        document.querySelector('#needModal h3').textContent = 'Post a Need';
        document.querySelector('#needModal button[type="submit"]').textContent = 'Post Need';
        
        document.getElementById('needModal').classList.add('active');
    }

    respondToNeed(needId) {
        if (!this.currentUser) {
            this.showAlert('Please login to respond', 'error');
            this.showAuthModal();
            return;
        }

        const need = this.needs.find(n => n.id === needId);
        if (!need) {
            this.showAlert('Need not found', 'error');
            return;
        }

        const author = this.members.find(m => m.id === need.authorId);
        if (!author) {
            this.showAlert('Could not find need author', 'error');
            return;
        }

        this.contactRecipient = author;
        document.getElementById('messageSubject').value = `Re: ${need.title}`;
        document.getElementById('messageContent').value = `Hi ${author.name},\n\nI'm interested in your posting: "${need.title}"\n\nI believe my skills in ${this.currentUser.skills.join(', ')} would be a great fit for your project.\n\nBest regards,\n${this.currentUser.name}`;
        
        document.getElementById('contactModal').classList.add('active');
    }

    findMatches(need) {
        if (!need.skills || need.skills.length === 0) return [];
        
        return this.members
            .filter(member => member.id !== need.authorId)
            .map(member => {
                const matchingSkills = member.skills.filter(skill => 
                    need.skills.some(needSkill => 
                        skill.toLowerCase().includes(needSkill.toLowerCase()) || 
                        needSkill.toLowerCase().includes(skill.toLowerCase())
                    )
                );
                return { ...member, matchingSkills };
            })
            .filter(member => member.matchingSkills.length > 0)
            .sort((a, b) => b.matchingSkills.length - a.matchingSkills.length);
    }

    // ====================================
    // EVENTS
    // ====================================
    async createEvent(e) {
        e.preventDefault();
        console.log('=== CREATE EVENT DEBUG ===');
        console.log('currentUser:', this.currentUser);
        console.log('user_status:', this.currentUser?.user_status);
        
        const submitBtn = e.target.querySelector('button[type="submit"]');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Creating...';
        }
        console.log('Form data:', {
            title: document.getElementById('eventTitle').value,
            date: document.getElementById('eventDate').value,
            time: document.getElementById('eventTime').value
        });
        
        if (!this.currentUser) {
            this.showAlert('Please login to create events', 'error');
            return;
        }

        const eventData = {
            title: document.getElementById('eventTitle').value,
            description: document.getElementById('eventDescription').value,
            date: document.getElementById('eventDate').value,
            time: document.getElementById('eventTime').value,
            location: document.getElementById('eventLocation').value,
            type: document.getElementById('eventType').value,
            organizer_id: this.currentUser.id
        };

        try {
            // Insert into database
            const { error } = await supabase
                .from('events')
                .insert([eventData]);

            if (error) throw error;

            // Try to add to Google Calendar
            const addToCalendar = document.getElementById('addToGoogleCalendar')?.checked;
            if (addToCalendar) {
                await this.addToGoogleCalendar(eventData);
            }

            this.closeModal(document.getElementById('eventModal'));
            this.showAlert('Event created successfully!', 'success');
            await this.loadEvents();
            this.renderUpcomingWeekEvents();
        } catch (error) {
            console.error('Create event error:', error);
            this.showAlert('Error creating event: ' + error.message, 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Create Event';
            }
        }
    }

    async addToGoogleCalendar(eventData) {
        // Create datetime string
        const dateTime = eventData.time 
            ? `${eventData.date}T${eventData.time}:00`
            : `${eventData.date}T12:00:00`;
        
        const startDateTime = new Date(dateTime).toISOString();
        const endDateTime = new Date(new Date(dateTime).getTime() + 2 * 60 * 60 * 1000).toISOString(); // +2 hours

        // Create Google Calendar link
        const calendarUrl = new URL('https://www.google.com/calendar/render');
        calendarUrl.searchParams.set('action', 'TEMPLATE');
        calendarUrl.searchParams.set('text', eventData.title);
        calendarUrl.searchParams.set('dates', `${startDateTime.replace(/[-:]/g, '').split('.')[0]}Z/${endDateTime.replace(/[-:]/g, '').split('.')[0]}Z`);
        calendarUrl.searchParams.set('details', eventData.description || '');
        calendarUrl.searchParams.set('location', eventData.location || '');
        calendarUrl.searchParams.set('add', GOOGLE_CALENDAR_ID);

        // Open in new window
        window.open(calendarUrl.toString(), '_blank');
        
        this.showAlert('Opening Google Calendar... Please add the event manually.', 'success');
    }

    showEventModal() {
        if (!this.currentUser) {
            this.showAlert('Please login to create events', 'error');
            this.showAuthModal();
            return;
        }
        if (this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can create events', 'error');
            return;
        }
        document.getElementById('eventModal').classList.add('active');
    }

    // ====================================
    // MESSAGING
    // ====================================
    contactMember(memberId) {
        if (!this.currentUser) {
            this.showAlert('Please login to send messages', 'error');
            this.showAuthModal();
            return;
        }

        const member = this.members.find(m => m.id === memberId);
        if (!member) return;

        this.contactRecipient = member;
        document.getElementById('messageSubject').value = `Message from ${this.currentUser.name}`;
        
        document.querySelectorAll('.modal.active').forEach(modal => modal.classList.remove('active'));
        document.getElementById('contactModal').classList.add('active');
    }

    async sendMessage(e) {
        e.preventDefault();
        if (!this.currentUser || !this.contactRecipient) return;

        const messageData = {
            from_id: this.currentUser.id,
            to_id: this.contactRecipient.id,
            subject: document.getElementById('messageSubject').value,
            content: document.getElementById('messageContent').value,
            sent_date: new Date().toISOString(),
            read: false
        };

        try {
            const { error } = await supabase
                .from('messages')
                .insert([messageData]);

            if (error) throw error;

            this.closeModal(document.getElementById('contactModal'));
            this.showAlert('Message sent successfully!', 'success');
            this.contactRecipient = null;
        } catch (error) {
            this.showAlert(error.message, 'error');
        }
    }

    // ====================================
    // RENDERING METHODS
    // ====================================
    showSection(sectionName) {
        console.log('Showing section:', sectionName, 'User:', this.currentUser?.name || 'Not logged in');
        
        if (sectionName === 'profile' && !this.currentUser) {
            this.showAlert('Please login to view your profile', 'error');
            this.showAuthModal();
            return;
        }

        // Update navigation
        document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
        const activeBtn = document.querySelector(`[data-section="${sectionName}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
            console.log('Activated nav button:', sectionName);
        }

        // Show section
        document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
        const targetSection = document.getElementById(sectionName);
        if (targetSection) {
            targetSection.classList.add('active');
            console.log('Section displayed:', sectionName);
        } else {
            console.error('Section not found:', sectionName);
        }

        // Load section-specific content
        switch(sectionName) {
            case 'directory':
                this.renderMembers();
                break;
            case 'needs':
                this.renderNeeds();
                break;
            case 'profile':
                this.loadUserProfileForm();
                break;
            case 'calendar':
                // Load calendar async in background
                this.renderUpcomingWeekEvents().catch(err => {
                    console.error('Error loading calendar:', err);
                });
                break;
            case 'checkin':
                this.loadCheckInStatuses();
                this.renderCheckInSection();
                break;
        }
    }

    renderMembers(filteredMembers = null) {
        const container = document.getElementById('memberGrid');
        const membersToRender = filteredMembers || this.members;

        container.innerHTML = membersToRender.map(member => `
            <div class="member-card fade-in">
                <div class="member-avatar">
                    ${member.avatar ? 
                        `<img src="${member.avatar}" alt="${member.name}">` : 
                        '<div class="avatar-placeholder">Photo</div>'
                    }
                </div>
                <div class="member-info">
                    <h4>${member.name}</h4>
                    ${member.user_status === 'admin' ? '<span class="status-badge">Admin</span>' : ''}
                    ${member.user_status === 'verified' ? '<span class="status-badge" style="background: #fff; color: #000;">Verified</span>' : ''}
                    ${member.user_status === 'unverified' ? '<span class="status-badge" style="background: #666; color: #fff;">Unverified</span>' : ''}
                    <p class="member-bio">${member.bio || 'No bio yet'}</p>
                    <div class="member-skills">
                        ${member.skills.map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                    </div>
                    ${this.currentUser?.user_status === 'admin' && this.currentUser.id !== member.id ? `
                        <div class="member-actions" style="margin-bottom: 1rem; border-top: 2px solid #000; padding-top: 1rem;">
                            <button class="btn btn-outline" onclick="event.stopPropagation(); app.toggleVerification('${member.id}', '${member.user_status}')" style="font-size: 0.7rem; padding: 0.5rem;">
                                ${member.user_status === 'verified' ? 'Unverify' : 'Verify'}
                            </button>
                            <button class="btn btn-outline" onclick="event.stopPropagation(); app.deleteMember('${member.id}')" style="font-size: 0.7rem; padding: 0.5rem; background: #000; color: #fff;">
                                Delete
                            </button>
                        </div>
                    ` : ''}
                    <div class="member-actions">
                        <button class="btn btn-outline" onclick="app.viewMemberProfile('${member.id}')">View Profile</button>
                        ${this.currentUser && this.currentUser.id !== member.id ? 
                            `<button class="btn btn-primary" onclick="app.contactMember('${member.id}')">Contact</button>` : 
                            ''}
                    </div>
                </div>
            </div>
        `).join('');
    }

    renderFeaturedMembers() {
        const featured = this.members.slice(0, 3);
        const container = document.getElementById('featuredMembers');
        
        container.innerHTML = featured.map(member => `
            <div class="member-card fade-in">
                <div class="member-avatar">
                    ${member.avatar ? 
                        `<img src="${member.avatar}" alt="${member.name}">` : 
                        '<div class="avatar-placeholder">Photo</div>'
                    }
                </div>
                <div class="member-info">
                    <h4>${member.name}</h4>
                    <p class="member-bio">${member.bio ? member.bio.substring(0, 120) + (member.bio.length > 120 ? '...' : '') : 'No bio yet'}</p>
                    <div class="member-skills">
                        ${member.skills.slice(0, 3).map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                    </div>
                    <div class="member-actions">
                        <button class="btn btn-outline" onclick="app.viewMemberProfile('${member.id}')">View Profile</button>
                        ${this.currentUser && this.currentUser.id !== member.id ? 
                            `<button class="btn btn-primary" onclick="app.contactMember('${member.id}')">Contact</button>` : 
                            ''}
                    </div>
                </div>
            </div>
        `).join('');
    }

    viewMemberProfile(memberId) {
        const member = this.members.find(m => m.id === memberId);
        if (!member) return;

        const modal = document.getElementById('memberModal');
        const content = document.getElementById('memberModalContent');
        
        content.innerHTML = `
            <div class="member-profile">
                <div class="member-avatar-large">
                    ${member.avatar ? 
                        `<img src="${member.avatar}" alt="${member.name}">` : 
                        '<div class="avatar-placeholder">Photo</div>'
                    }
                </div>
                <h2>${member.name}</h2>
                ${member.user_status === 'admin' ? '<span class="status-badge">Admin</span>' : ''}
                <div class="member-details">
                    <h4>About</h4>
                    <p>${member.bio || 'No bio yet'}</p>
                    
                    <h4>Skills</h4>
                    <div class="member-skills">
                        ${member.skills.map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                    </div>
                    
                    ${member.projects && member.projects.length > 0 ? `
                        <h4>Portfolio Projects</h4>
                        ${member.projects.map(project => `
                            <div class="portfolio-project">
                                ${project.image ? `<img src="${project.image}" alt="${project.title}" class="project-image">` : ''}
                                <h4>${project.title}</h4>
                                <p>${project.description}</p>
                                ${project.link ? `<a href="${project.link}" target="_blank" class="btn btn-outline">View Project</a>` : ''}
                            </div>
                        `).join('')}
                    ` : ''}
                    
                    ${member.portfolio ? `
                        <h4>Portfolio</h4>
                        <a href="${member.portfolio}" target="_blank" class="btn btn-outline">View Portfolio</a>
                    ` : ''}
                    
                    ${member.website ? `
                        <h4>Website</h4>
                        <a href="${member.website}" target="_blank" class="btn btn-outline">Visit Website</a>
                    ` : ''}
                    
                    ${member.social ? `
                        <h4>Social Media</h4>
                        <p>${member.social}</p>
                    ` : ''}
                    
                    ${this.currentUser && this.currentUser.id !== member.id ? `
                        <div class="member-actions mt-3">
                            <button class="btn btn-primary" onclick="app.contactMember('${member.id}')">Send Message</button>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
        
        modal.classList.add('active');
    }

    renderNeeds() {
        const container = document.getElementById('needsGrid');
        
        if (this.needs.length === 0) {
            container.innerHTML = '<p class="empty-state">No active needs at the moment. Be the first to post!</p>';
            return;
        }
        
        container.innerHTML = this.needs.map(need => {
            const author = this.members.find(m => m.id === need.authorId);
            const matches = this.findMatches(need);
            const postedDate = new Date(need.postedDate);
            const daysAgo = Math.floor((new Date() - postedDate) / (1000 * 60 * 60 * 24));
            const timeAgo = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;
            
            return `
                <div class="need-card fade-in">
                    <div class="need-header">
                        <div>
                            <h3 class="need-title">${need.title}</h3>
                            <p class="need-author">Posted by ${author?.name || 'Unknown'} • ${timeAgo}</p>
                        </div>
                        <div class="need-budget">${need.budget}</div>
                    </div>
                    <p class="need-description">${need.description}</p>
                    ${need.deadline ? `<p class="need-deadline"><strong>Deadline:</strong> ${new Date(need.deadline).toLocaleDateString()}</p>` : ''}
                    <div class="need-skills">
                        ${need.skills.map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                    </div>
                    ${matches.length > 0 && this.currentUser ? `
                        <div class="matches-section">
                            <h4>✨ Potential Matches (${matches.length})</h4>
                            ${matches.slice(0, 3).map(match => `
                                <div class="match-item">
                                    <div class="match-info">
                                        <h5>${match.name}</h5>
                                        <p>${match.bio.substring(0, 100)}${match.bio.length > 100 ? '...' : ''}</p>
                                        <div class="match-skills">
                                            ${match.matchingSkills.map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                                        </div>
                                    </div>
                                    ${this.currentUser.id !== match.id ? `<button class="btn btn-primary" onclick="app.contactMember('${match.id}')">Contact</button>` : ''}
                                </div>
                            `).join('')}
                            ${matches.length > 3 ? `<p style="text-align: center; margin-top: 1rem; font-weight: 700;">+${matches.length - 3} more matches</p>` : ''}
                        </div>
                    ` : ''}
                    <div class="need-actions">
                        ${this.currentUser && this.currentUser.id !== need.authorId ? 
                            `<button class="btn btn-primary" onclick="app.respondToNeed('${need.id}')">Respond to Need</button>` : 
                            this.currentUser && this.currentUser.id === need.authorId ?
                            `<button class="btn btn-outline" onclick="app.editNeed('${need.id}')">Edit</button>
                            <button class="btn btn-outline" onclick="app.markNeedClosed('${need.id}')">Mark as Closed</button>` :
                            `<button class="btn btn-outline" onclick="app.showAlert('Please login to respond', 'error'); app.showAuthModal();">Login to Respond</button>`
                        }
                        ${this.currentUser?.user_status === 'admin' && this.currentUser.id !== need.authorId ? `
                            <button class="btn btn-outline" onclick="app.adminDeleteNeed('${need.id}')" style="background: #000; color: #fff; font-size: 0.7rem;">Admin Delete</button>
                        ` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderLatestNeeds() {
        const latest = this.needs.slice(0, 3);
        const container = document.getElementById('latestNeeds');
        
        container.innerHTML = latest.map(need => {
            const author = this.members.find(m => m.id === need.authorId);
            return `
                <div class="need-card fade-in">
                    <div class="need-header">
                        <div>
                            <h3 class="need-title">${need.title}</h3>
                            <p class="need-author">Posted by ${author?.name || 'Unknown'}</p>
                        </div>
                        <div class="need-budget">${need.budget}</div>
                    </div>
                    <p class="need-description">${need.description.substring(0, 150)}${need.description.length > 150 ? '...' : ''}</p>
                    <div class="need-skills">
                        ${need.skills.slice(0, 4).map(skill => `<span class="skill-tag">${skill}</span>`).join('')}
                    </div>
                    <div class="need-actions">
                        <button class="btn btn-outline" onclick="app.showSection('needs')">View All Needs</button>
                        ${this.currentUser && this.currentUser.id !== need.authorId ? 
                            `<button class="btn btn-primary" onclick="app.respondToNeed('${need.id}')">Respond</button>` : 
                            ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    async renderUpcomingEventsHome() {
        const container = document.getElementById('upcomingEvents');
        if (!container) {
            console.error('upcomingEvents container not found!');
            return;
        }
        
        console.log('Rendering upcoming events for home page...');
        container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        
        try {
            const googleEvents = await this.fetchGoogleCalendarEvents();
            console.log('Google events fetched:', googleEvents.length);
            
            if (googleEvents.length === 0) {
                console.log('No events found');
                container.innerHTML = '<p class="empty-state">No upcoming events</p>';
                return;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const eventsHTML = googleEvents.slice(0, 6).map(event => {
                const eventDate = new Date(event.start.dateTime || event.start.date);
                const daysUntil = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24));
                const dayLabel = daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`;
                
                return `
                    <div class="event-card">
                        <span class="event-day-label">${dayLabel}</span>
                        <div class="event-header">
                            <h4 class="event-title">${event.summary || 'Untitled Event'}</h4>
                        </div>
                        <div class="event-details">
                            <div class="event-detail">
                                <strong>Date:</strong> ${eventDate.toLocaleDateString()}
                            </div>
                            ${event.start.dateTime ? `<div class="event-detail"><strong>Time:</strong> ${new Date(event.start.dateTime).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>` : ''}
                            ${event.location ? `<div class="event-detail"><strong>Location:</strong> ${event.location}</div>` : ''}
                        </div>
                        ${event.description ? `<p class="event-description">${event.description.substring(0, 100)}${event.description.length > 100 ? '...' : ''}</p>` : ''}
                        <button class="btn btn-outline" onclick="app.showSection('calendar')" style="margin-top: auto;">View All Events</button>
                    </div>
                `;
            }).join('');
            
            // Create a wrapper div with proper grid styling
            const wrapper = document.createElement('div');
            wrapper.className = 'events-grid';
            wrapper.style.gridTemplateColumns = 'repeat(3, 1fr)';
            wrapper.innerHTML = eventsHTML;
            container.innerHTML = '';
            container.appendChild(wrapper);
            
            console.log('Events rendered successfully');
        } catch (error) {
            console.error('Render events error:', error);
            container.innerHTML = '<p class="empty-state">Failed to load events</p>';
        }
    }

    async renderUpcomingWeekEvents() {
        const container = document.getElementById('upcomingWeekEvents');
        if (!container) return;
        
        container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
        
        try {
            const googleEvents = await this.fetchGoogleCalendarEvents();
            
            if (googleEvents.length === 0) {
                container.innerHTML = '<p class="empty-state">No events in the next 7 days</p>';
                return;
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const eventsHTML = googleEvents.map(event => {
                const eventDate = new Date(event.start.dateTime || event.start.date);
                const daysUntil = Math.ceil((eventDate - today) / (1000 * 60 * 60 * 24));
                const dayLabel = daysUntil === 0 ? 'Today' : daysUntil === 1 ? 'Tomorrow' : `In ${daysUntil} days`;
                
                return `
                    <div class="event-card">
                        <span class="event-day-label">${dayLabel}</span>
                        <div class="event-header">
                            <h4 class="event-title">${event.summary || 'Untitled Event'}</h4>
                        </div>
                        <div class="event-details">
                            <div class="event-detail">
                                <strong>Date:</strong> ${eventDate.toLocaleDateString()}
                            </div>
                            ${event.start.dateTime ? `<div class="event-detail"><strong>Time:</strong> ${new Date(event.start.dateTime).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</div>` : ''}
                            ${event.location ? `<div class="event-detail"><strong>Location:</strong> ${event.location}</div>` : ''}
                        </div>
                        ${event.description ? `<p class="event-description">${event.description.substring(0, 100)}${event.description.length > 100 ? '...' : ''}</p>` : ''}
                        ${event.htmlLink ? `<a href="${event.htmlLink}" target="_blank" class="btn btn-outline" style="margin-top: auto;">View Details</a>` : ''}
                    </div>
                `;
            }).join('');
            
            // Create a wrapper div with proper grid styling (same as home page)
            const wrapper = document.createElement('div');
            wrapper.className = 'events-grid';
            wrapper.style.gridTemplateColumns = 'repeat(3, 1fr)';
            wrapper.innerHTML = eventsHTML;
            container.innerHTML = '';
            container.appendChild(wrapper);
            
            console.log('Calendar events rendered successfully');
        } catch (error) {
            container.innerHTML = '<p class="empty-state">Failed to load events</p>';
            console.error(error);
        }
    }
    async toggleVerification(memberId, currentStatus) {
        console.log('=== TOGGLE VERIFICATION DEBUG ===');
        console.log('memberId:', memberId);
        console.log('currentStatus:', currentStatus);
        console.log('currentUser:', this.currentUser);
        console.log('currentUser.user_status:', this.currentUser?.user_status);
        console.log('Is admin?:', this.currentUser?.user_status === 'admin');
        
        if (!this.currentUser) {
            this.showAlert('Please login to verify members', 'error');
            return;
        }
        
        if (this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can verify members. Your status: ' + this.currentUser.user_status, 'error');
            return;
        }

        const newStatus = currentStatus === 'verified' ? 'unverified' : 'verified';
        
        if (!confirm(`Are you sure you want to ${newStatus === 'verified' ? 'verify' : 'unverify'} this member?`)) {
            return;
        }

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ user_status: newStatus })
                .eq('id', memberId);

            if (error) throw error;

            this.showAlert(`Member ${newStatus === 'verified' ? 'verified' : 'unverified'} successfully`, 'success');
            await this.loadMembers();
            this.renderMembers();
        } catch (error) {
            console.error('Verification error:', error);
            this.showAlert('Error updating member: ' + error.message, 'error');
        }
    }

    async deleteMember(memberId) {
        console.log('deleteMember called:', { memberId, currentUser: this.currentUser });
        
        if (!this.currentUser) {
            this.showAlert('Please login to delete members', 'error');
            return;
        }
        
        if (this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can delete members. Your status: ' + this.currentUser.user_status, 'error');
            return;
        }

        if (!confirm('Are you sure you want to delete this member? This action cannot be undone!')) {
            return;
        }

        try {
            // Delete user's missions first
            const { error: missionsError } = await supabase
                .from('missions')
                .delete()
                .eq('author_id', memberId);
            
            if (missionsError) console.warn('Error deleting missions:', missionsError);
            
            // Delete user's messages
            const { error: messagesError } = await supabase
                .from('messages')
                .delete()
                .or(`from_id.eq.${memberId},to_id.eq.${memberId}`);
            
            if (messagesError) console.warn('Error deleting messages:', messagesError);
            
            // Delete profile
            const { error } = await supabase
                .from('profiles')
                .delete()
                .eq('id', memberId);

            if (error) throw error;

            this.showAlert('Member deleted successfully', 'success');
            await this.loadMembers();
            this.renderMembers();
        } catch (error) {
            console.error('Delete member error:', error);
            this.showAlert('Error deleting member: ' + error.message, 'error');
        }
    }
    async adminDeleteNeed(needId) {
        if (!this.currentUser || this.currentUser.user_status !== 'admin') {
            this.showAlert('Only admins can delete needs', 'error');
            return;
        }

        if (!confirm('Are you sure you want to delete this need? This action cannot be undone!')) {
            return;
        }

        try {
            const { error } = await supabase
                .from('missions')
                .delete()
                .eq('id', needId);

            if (error) throw error;

            this.showAlert('Need deleted successfully', 'success');
            await this.loadMissions();
            this.renderNeeds();
        } catch (error) {
            console.error('Delete need error:', error);
            this.showAlert('Error deleting need: ' + error.message, 'error');
        }
    }
    // ====================================
    // PHOTO GALLERY
    // ====================================
    async uploadToGallery(bucketName, prefix = '') {
        if (!this.currentUser) {
            this.showAlert('Please login first', 'error');
            return null;
        }

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.multiple = true;

        return new Promise((resolve) => {
            fileInput.onchange = async (e) => {
                const files = Array.from(e.target.files);
                if (files.length === 0) {
                    resolve(null);
                    return;
                }

                const uploadedUrls = [];
                
                for (const file of files) {
                    if (!file.type.startsWith('image/')) continue;
                    if (file.size > 5 * 1024 * 1024) continue; // Skip files > 5MB

                    try {
                        const fileExt = file.name.split('.').pop();
                        const fileName = `${this.currentUser.id}/${prefix}${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${fileExt}`;

                        const { error } = await supabase.storage
                            .from(bucketName)
                            .upload(fileName, file, {
                                cacheControl: '3600',
                                upsert: false
                            });

                        if (error) throw error;

                        const { data: { publicUrl } } = supabase.storage
                            .from(bucketName)
                            .getPublicUrl(fileName);

                        uploadedUrls.push(publicUrl);
                    } catch (error) {
                        console.error('Upload error:', error);
                    }
                }

                resolve(uploadedUrls);
            };

            fileInput.click();
        });
    }

    async addProfileGalleryPhotos() {
        const urls = await this.uploadToGallery('profile-galleries', 'gallery-');
        if (!urls || urls.length === 0) return;

        if (!this.currentUser.profile_gallery) {
            this.currentUser.profile_gallery = [];
        }

        this.currentUser.profile_gallery = [...this.currentUser.profile_gallery, ...urls];

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ profile_gallery: this.currentUser.profile_gallery })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            this.showAlert(`Added ${urls.length} photo(s) to gallery`, 'success');
            this.renderProfileGallery();
        } catch (error) {
            this.showAlert('Error saving gallery: ' + error.message, 'error');
        }
    }

    async removeProfileGalleryPhoto(index) {
        if (!this.currentUser || !this.currentUser.profile_gallery) return;
        
        if (!confirm('Remove this photo from your gallery?')) return;

        this.currentUser.profile_gallery.splice(index, 1);

        try {
            const { error } = await supabase
                .from('profiles')
                .update({ profile_gallery: this.currentUser.profile_gallery })
                .eq('id', this.currentUser.id);

            if (error) throw error;

            this.showAlert('Photo removed', 'success');
            this.renderProfileGallery();
        } catch (error) {
            this.showAlert('Error removing photo: ' + error.message, 'error');
        }
    }

    renderProfileGallery() {
        const container = document.getElementById('profileGalleryGrid');
        if (!container) return;

        if (!this.currentUser.profile_gallery || this.currentUser.profile_gallery.length === 0) {
            container.innerHTML = '<p class="empty-state">No photos yet - add some to showcase yourself!</p>';
            return;
        }

        container.innerHTML = `
            <div class="gallery-grid">
                ${this.currentUser.profile_gallery.map((url, index) => `
                    <div class="gallery-item" onclick="app.viewGallery(app.currentUser.profile_gallery, ${index})">
                        ${index === 0 ? '<span class="gallery-item-badge">Cover</span>' : ''}
                        <span class="gallery-item-remove" onclick="event.stopPropagation(); app.removeProfileGalleryPhoto(${index})">×</span>
                        <img src="${url}" alt="Gallery photo ${index + 1}">
                    </div>
                `).join('')}
                <div class="gallery-add-btn" onclick="app.addProfileGalleryPhotos()">+</div>
            </div>
        `;
    }

    viewGallery(images, startIndex = 0) {
        this.currentGallery = images;
        this.currentGalleryIndex = startIndex;
        
        document.getElementById('galleryImage').src = images[startIndex];
        document.getElementById('galleryCounter').textContent = `${startIndex + 1} / ${images.length}`;
        document.getElementById('galleryModal').classList.add('active');
    }

    nextGalleryImage() {
        if (this.currentGalleryIndex < this.currentGallery.length - 1) {
            this.currentGalleryIndex++;
            document.getElementById('galleryImage').src = this.currentGallery[this.currentGalleryIndex];
            document.getElementById('galleryCounter').textContent = `${this.currentGalleryIndex + 1} / ${this.currentGallery.length}`;
        }
    }

    prevGalleryImage() {
        if (this.currentGalleryIndex > 0) {
            this.currentGalleryIndex--;
            document.getElementById('galleryImage').src = this.currentGallery[this.currentGalleryIndex];
            document.getElementById('galleryCounter').textContent = `${this.currentGalleryIndex + 1} / ${this.currentGallery.length}`;
        }
    }
    // ====================================
    // FILTERING & SEARCH
    // ====================================
    filterMembers() {
        const searchTerm = document.getElementById('memberSearch').value.toLowerCase();
        const selectedSkill = document.getElementById('skillFilter').value;

        let filtered = this.members.filter(member => {
            const matchesSearch = !searchTerm || 
                member.name.toLowerCase().includes(searchTerm) ||
                member.bio.toLowerCase().includes(searchTerm) ||
                member.skills.some(skill => skill.toLowerCase().includes(searchTerm));

            const matchesSkill = !selectedSkill || member.skills.includes(selectedSkill);

            return matchesSearch && matchesSkill;
        });

        this.renderMembers(filtered);
    }

    populateSkillFilters() {
        const allSkills = [...new Set(this.members.flatMap(m => m.skills))].sort();
        const select = document.getElementById('skillFilter');
        
        while (select.options.length > 1) {
            select.remove(1);
        }
        
        allSkills.forEach(skill => {
            const option = document.createElement('option');
            option.value = skill;
            option.textContent = skill;
            select.appendChild(option);
        });
    }

    // ====================================
    // UI HELPERS
    // ====================================
    async updateStats() {
        document.getElementById('memberCount').textContent = this.members.length;
        document.getElementById('needsCount').textContent = this.needs.filter(n => n.status === 'open').length;
        
        // Count checked in members
        const checkedIn = this.checkInStatuses.filter(s => s.status === 'in').length;
        const checkedInEl = document.getElementById('checkedInCount');
        if (checkedInEl) {
            checkedInEl.textContent = checkedIn;
        }
        
        // Count only Google Calendar events in next 7 days
        try {
            const googleEvents = await this.fetchGoogleCalendarEvents();
            document.getElementById('eventsCount').textContent = googleEvents.length;
        } catch (error) {
            console.error('Error counting events:', error);
            document.getElementById('eventsCount').textContent = '0';
        }
    }

    showAuthModal() {
        document.getElementById('authModal').classList.add('active');
    }

    closeModal(modal) {
        modal.classList.remove('active');
        this.clearForms();
    }

    clearForms() {
        document.querySelectorAll('form').forEach(form => form.reset());
    }

    showAlert(message, type = 'success') {
        document.querySelectorAll('.alert').forEach(alert => alert.remove());

        const alert = document.createElement('div');
        alert.className = `alert alert-${type} fade-in`;
        alert.textContent = message;

        const main = document.querySelector('.main');
        main.insertBefore(alert, main.firstChild);

        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, 5000);
    }
    // ====================================
    // CHECK-IN SYSTEM
    // ====================================
    async loadCheckInStatuses() {
        try {
            console.log('Loading check-in statuses...');
            
            const { data, error } = await supabase
                .from('current_check_in_status')
                .select('*');

            if (error) throw error;

            this.checkInStatuses = data || [];
            console.log('✓ Loaded', this.checkInStatuses.length, 'check-in statuses');
        } catch (error) {
            console.error('Load check-in statuses error:', error);
            this.checkInStatuses = [];
        }
    }

    async renderCheckInSection() {
        if (!this.currentUser) {
            document.getElementById('checkinAccessDenied').style.display = 'block';
            document.getElementById('userCheckinCard').style.display = 'none';
            document.getElementById('adminCheckinControls').style.display = 'none';
            return;
        }

        if (this.currentUser.user_status === 'unverified') {
            document.getElementById('checkinAccessDenied').style.display = 'block';
            document.getElementById('userCheckinCard').style.display = 'none';
            document.getElementById('adminCheckinControls').style.display = 'none';
            return;
        }

        document.getElementById('checkinAccessDenied').style.display = 'none';
        document.getElementById('userCheckinCard').style.display = 'block';

        // Show current status
        await this.updateUserCheckInStatus();

        // Show admin controls if admin
        if (this.currentUser.user_status === 'admin') {
            document.getElementById('adminCheckinControls').style.display = 'block';
            await this.renderAdminCheckInList();
        } else {
            document.getElementById('adminCheckinControls').style.display = 'none';
        }
    }

    async updateUserCheckInStatus() {
        if (!this.currentUser) return;

        try {
            const { data, error } = await supabase
                .from('current_check_in_status')
                .select('*')
                .eq('user_id', this.currentUser.id)
                .maybeSingle();

            if (error && error.code !== 'PGRST116') throw error;

            const currentStatus = data?.status || 'out';
            const timestamp = data?.timestamp ? new Date(data.timestamp) : null;

            const statusText = document.getElementById('userStatusText');
            const statusTime = document.getElementById('userStatusTime');
            const toggleBtn = document.getElementById('toggleStatusBtn');
            const toggleBtnText = document.getElementById('toggleStatusText');
            const toggleBtnIcon = document.getElementById('toggleStatusIcon');

            if (currentStatus === 'in') {
                statusText.textContent = 'You are IN the space';
                toggleBtn.className = 'circular-checkin-btn status-in';
                toggleBtnText.textContent = 'Check Out';
                toggleBtnIcon.textContent = '●';
                toggleBtnIcon.style.color = '#000';
            } else {
                statusText.textContent = 'You are OUT';
                toggleBtn.className = 'circular-checkin-btn status-out';
                toggleBtnText.textContent = 'Check In';
                toggleBtnIcon.textContent = '○';
                toggleBtnIcon.style.color = '#000';
            }

            if (timestamp) {
                const timeAgo = this.getTimeAgo(timestamp);
                statusTime.textContent = `Last updated ${timeAgo}`;
            } else {
                statusTime.textContent = 'No check-ins yet';
            }
        } catch (error) {
            console.error('Error loading user status:', error);
        }
    }

    async toggleUserCheckIn() {
        if (!this.currentUser) return;

        try {
            const { data: current, error: fetchError } = await supabase
                .from('current_check_in_status')
                .select('status')
                .eq('user_id', this.currentUser.id)
                .maybeSingle();

            if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

            const currentStatus = current?.status || 'out';
            const newStatus = currentStatus === 'in' ? 'out' : 'in';

            const { error: insertError } = await supabase
                .from('check_ins')
                .insert([{
                    user_id: this.currentUser.id,
                    status: newStatus,
                    timestamp: new Date().toISOString()
                }]);

            if (insertError) throw insertError;

            this.showAlert(`Successfully checked ${newStatus}!`, 'success');
            await this.loadCheckInStatuses();
            await this.updateUserCheckInStatus();
            
            if (this.currentUser.user_status === 'admin') {
                await this.renderAdminCheckInList();
            }
        } catch (error) {
            console.error('Toggle check-in error:', error);
            this.showAlert('Error updating status: ' + error.message, 'error');
        }
    }

    async renderAdminCheckInList() {
        const container = document.getElementById('adminCheckinList');
        if (!container) return;

        await this.loadCheckInStatuses();
        await this.loadMembers();

        // Calculate stats
        const inSpace = this.checkInStatuses.filter(s => s.status === 'in').length;
        const checkedOut = this.checkInStatuses.filter(s => s.status === 'out').length;
        
        document.getElementById('totalInSpace').textContent = inSpace;
        document.getElementById('totalCheckedOut').textContent = checkedOut;

        // Get all members with their status
        const membersWithStatus = this.members.map(member => {
            const status = this.checkInStatuses.find(s => s.user_id === member.id);
            return {
                ...member,
                checkInStatus: status?.status || 'out',
                lastUpdate: status?.timestamp || null,
                manually_set_by: status?.manually_set_by || null
            };
        });

        // Filter based on current filter
        let filteredMembers = membersWithStatus;
        if (this.currentCheckInFilter === 'in') {
            filteredMembers = membersWithStatus.filter(m => m.checkInStatus === 'in');
        } else if (this.currentCheckInFilter === 'out') {
            filteredMembers = membersWithStatus.filter(m => m.checkInStatus === 'out');
        }

        // Sort: in first, then by name
        filteredMembers.sort((a, b) => {
            if (a.checkInStatus === 'in' && b.checkInStatus !== 'in') return -1;
            if (a.checkInStatus !== 'in' && b.checkInStatus === 'in') return 1;
            return a.name.localeCompare(b.name);
        });

        container.innerHTML = filteredMembers.map(member => {
            const timeAgo = member.lastUpdate ? this.getTimeAgo(new Date(member.lastUpdate)) : 'Never';
            return `
                <div class="admin-checkin-item ${member.checkInStatus === 'in' ? 'status-in' : 'status-out'}">
                    <div class="checkin-item-info">
                        <div class="checkin-item-header">
                            <h4>${member.name}</h4>
                            <span class="checkin-status-badge status-${member.checkInStatus}">
                                ${member.checkInStatus === 'in' ? '● IN' : '○ OUT'}
                            </span>
                        </div>
                        <p class="checkin-time">Last update: ${timeAgo}</p>
                    </div>
                    <div class="checkin-item-actions">
                        <button class="btn btn-outline btn-sm" onclick="app.adminSetStatus('${member.id}', 'in')">
                            Set IN
                        </button>
                        <button class="btn btn-outline btn-sm" onclick="app.adminSetStatus('${member.id}', 'out')">
                            Set OUT
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    async adminSetStatus(userId, status) {
        if (!this.currentUser || this.currentUser.user_status !== 'admin') {
            this.showAlert('Admin access required', 'error');
            return;
        }

        const member = this.members.find(m => m.id === userId);
        if (!confirm(`Set ${member?.name || 'this member'} as ${status.toUpperCase()}?`)) {
            return;
        }

        try {
            const { error } = await supabase
                .from('check_ins')
                .insert([{
                    user_id: userId,
                    status: status,
                    manually_set_by: this.currentUser.id,
                    timestamp: new Date().toISOString()
                }]);

            if (error) throw error;

            this.showAlert(`Status updated to ${status.toUpperCase()}`, 'success');
            await this.loadCheckInStatuses();
            await this.renderAdminCheckInList();
        } catch (error) {
            console.error('Admin set status error:', error);
            this.showAlert('Error updating status: ' + error.message, 'error');
        }
    }

    setCheckInFilter(filter) {
        this.currentCheckInFilter = filter;
        
        document.querySelectorAll('.checkin-filters .filter-btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.querySelector(`[data-filter="${filter}"]`).classList.add('active');
        
        this.renderAdminCheckInList();
    }

    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
        if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
        
        return date.toLocaleDateString();
    }
    // ====================================
    // EVENT BINDING
    // ====================================
    bindEvents() {
        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.showSection(e.target.dataset.section));
        });

        // Authentication
        document.getElementById('authBtn').addEventListener('click', () => {
            if (this.currentUser) {
                this.logout();
            } else {
                this.showAuthModal();
            }
        });
        document.getElementById('authForm').addEventListener('submit', (e) => this.handleAuth(e));
        document.getElementById('googleSignInBtn').addEventListener('click', () => this.signInWithGoogle());
        document.getElementById('authToggleLink').addEventListener('click', (e) => {
            e.preventDefault();
            this.toggleAuthMode();
        });

        // Onboarding
        document.getElementById('onboardingForm').addEventListener('submit', (e) => this.completeOnboarding(e));

        // Profile
        document.getElementById('profileForm').addEventListener('submit', (e) => this.saveProfile(e));
        document.getElementById('profileName').addEventListener('input', () => this.updateProfilePreview());
        document.getElementById('profileBio').addEventListener('input', () => this.updateProfilePreview());
        document.getElementById('profileSkills').addEventListener('input', () => this.updateProfilePreview());
        document.getElementById('profilePortfolio').addEventListener('input', () => this.updateProfilePreview());
        document.getElementById('profileAvatar').addEventListener('input', () => this.updateAvatarPreview());
        document.getElementById('addProjectBtn').addEventListener('click', () => this.showProjectModal());
        const profilePhotosInput = document.getElementById('profilePhotosInput');
        if (profilePhotosInput) {
            profilePhotosInput.addEventListener('change', (e) => this.handleProfilePhotos(e));
        }
        
        const uploadProjectImageBtn = document.getElementById('uploadProjectImageBtn');
        if (uploadProjectImageBtn) {
            uploadProjectImageBtn.addEventListener('click', () => this.uploadProjectImage());
        }

        // Skill suggestions
        document.querySelectorAll('.skills-suggestions .skill-tag').forEach(tag => {
            tag.addEventListener('click', () => this.addSkillToInput(tag.dataset.skill));
        });

        // Needs
        document.getElementById('postNeedBtn').addEventListener('click', () => this.showNeedModal());
        document.getElementById('needForm').addEventListener('submit', (e) => this.postMission(e));

        // Events
        const createEventBtn = document.getElementById('createEventBtn');
        if (createEventBtn) {
            createEventBtn.addEventListener('click', () => this.showEventModal());
        }
        document.getElementById('eventForm').addEventListener('submit', (e) => this.createEvent(e));

        // Projects
        document.getElementById('projectForm').addEventListener('submit', (e) => this.addProject(e));
        document.getElementById('projectImage').addEventListener('input', () => this.updateProjectImagePreview());

        // Search and filters
        document.getElementById('memberSearch').addEventListener('input', () => this.filterMembers());
        document.getElementById('skillFilter').addEventListener('change', () => this.filterMembers());

        // Contact
        document.getElementById('contactForm').addEventListener('submit', (e) => this.sendMessage(e));

        // Modal controls
        document.querySelectorAll('.close').forEach(close => {
            close.addEventListener('click', (e) => this.closeModal(e.target.closest('.modal')));
        });

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeModal(modal);
            });
        });
        // Check-in
        const toggleStatusBtn = document.getElementById('toggleStatusBtn');
        if (toggleStatusBtn) {
            toggleStatusBtn.addEventListener('click', () => this.toggleUserCheckIn());
        }

        // Check-in filters
        document.querySelectorAll('.checkin-filters .filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setCheckInFilter(e.target.dataset.filter));
        });
        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.active').forEach(modal => {
                    this.closeModal(modal);
                });
            }
        });
    }
}

// ====================================
// INITIALIZATION
// ====================================
let app;

document.addEventListener('DOMContentLoaded', async () => {
    console.log('=== DOM Content Loaded ===');
    console.log('Starting DōM Collective...');
    
    // Check if Supabase loaded
    if (typeof window.supabase === 'undefined') {
        console.error('ERROR: Supabase library not loaded!');
        alert('Failed to load Supabase. Check your internet connection and try refreshing.');
        return;
    }
    console.log('✓ Supabase library loaded');
    console.log('✓ Supabase connection ready');
    
    // Initialize app
    try {
        console.log('Creating CreativeCollective instance...');
        app = new CreativeCollective();
        window.app = app;
        console.log('✓ Instance created');
        
        // Now initialize
        console.log('Calling init()...');
        await app.init();
        console.log('✓ Init completed');
        
        // Expose for debugging
        window.supabase = supabase;
        console.log('✓ Setup complete');
    } catch (error) {
        console.error('=== INITIALIZATION FAILED ===');
        console.error('Error:', error);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        alert('Failed to initialize app: ' + error.message + '\n\nCheck the console for details.');
    }
});
