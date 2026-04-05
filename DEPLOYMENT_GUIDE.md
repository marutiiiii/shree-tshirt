# Deployment Guide for Shree T-Shirt Application

## Overview
This project consists of:
- **Frontend**: Static HTML/CSS/JS (Deploy on Netlify)
- **Backend**: Flask API (Deploy on Render)
- **Database**: Supabase (Already configured)

---

## Backend Deployment (Render)

### Step 1: Prepare Backend for Render
1. Make sure you have a `Procfile` in the `backend/` folder ✓
2. Ensure `gunicorn` is in `requirements.txt` ✓
3. Create a `.env` file based on `.env.example` with actual secrets:

```bash
FLASK_ENV=production
SECRET_KEY=your-very-secure-random-key-here
SUPABASE_URL=https://hsnlgbtiakdcjydvgkzj.supabase.co/
SUPABASE_ANON_KEY=your-supabase-anon-key-here
CORS_ORIGINS=https://your-netlify-domain.netlify.app,https://your-custom-domain.com
```

### Step 2: Deploy to Render

1. Go to [render.com](https://render.com) and sign in with GitHub
2. Click **New +** → **Web Service**
3. Connect your GitHub repository (marutiiiii/shree-tshirt)
4. Configure:
   - **Name**: `shree-tshirt-api`
   - **Root Directory**: `backend`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn --bind 0.0.0.0:$PORT app:app`
   - **Environment**: Python 3
   - **Region**: Choose closest to your users

5. Add Environment Variables:
   - Click **Environment** and add all variables from `.env.example`:
     - `FLASK_ENV`: `production`
     - `SECRET_KEY`: Generate a strong random key
     - `SUPABASE_URL`: Your Supabase URL
     - `SUPABASE_ANON_KEY`: Your Supabase anonymous key
     - `CORS_ORIGINS`: Your Netlify frontend domain

6. Deploy and wait for build to complete
7. **Note the URL** (e.g., `https://shree-tshirt-api.render.com`)

---

## Frontend Deployment (Netlify)

### Step 1: Prepare Frontend for Netlify

1. Ensure `netlify.toml` exists in root ✓
2. The frontend is static - no build needed
3. Create a `netlify.env` file for production API URL:

```
VITE_API_BASE=https://shree-tshirt-api.render.com
```

**Note**: Update the script in `index.html` to set the API base:

Add this line in `<head>` of `index.html`:
```html
<script>
  window.__API_BASE__ = 'https://shree-tshirt-api.render.com'; // Replace with your Render URL
</script>
```

Or inject via Netlify's environment variables directly in the HTML via a build hook.

### Step 2: Deploy to Netlify

1. Go to [netlify.com](https://netlify.com) and sign in with GitHub
2. Click **New site from Git**
3. Connect your GitHub repository (marutiiiii/shree-tshirt)
4. Configure:
   - **Base directory**: `.` (root)
   - **Build command**: (leave empty - static site)
   - **Publish directory**: `.` (root)

5. Add Environment Variables:
   - **VITE_API_BASE**: `https://your-render-backend-url.render.com`

6. Deploy and get your Netlify domain (e.g., `https://your-project.netlify.app`)

### Step 3: Update Backend CORS

Go back to Render and update the `CORS_ORIGINS` environment variable to include your Netlify domain:

```
CORS_ORIGINS=https://your-project.netlify.app,https://your-custom-domain.com
```

---

## Post-Deployment Checklist

- [ ] Backend is deployed on Render
- [ ] Frontend is deployed on Netlify
- [ ] Frontend API points to the correct Render backend URL
- [ ] Backend CORS includes Netlify frontend domain
- [ ] Test health endpoint: `https://your-render-backend.render.com/health`
- [ ] Test API calls from frontend in production
- [ ] Check browser console for CORS errors
- [ ] Verify all API routes work (auth, schools, students, invoices)
- [ ] Test with real Supabase database
- [ ] Set up custom domain (optional)

---

## Troubleshooting

### CORS Errors
- Ensure `CORS_ORIGINS` includes your Netlify domain
- Check that the frontend is using the correct backend URL
- Verify no trailing slashes in URLs

### 404 Errors on Frontend
- Check `netlify.toml` redirects are correct
- Ensure `index.html` exists in root

### Backend Not Responding
- Check Render logs for deployment errors
- Verify all environment variables are set
- Ensure Supabase credentials are correct
- Check that Procfile is in backend/ directory

### API Calls Failing
- Check network tab in browser DevTools
- Verify the backend URL is correct
- Look at Render backend logs for error details
- Ensure Supabase database is accessible

---

## Environment Variables Summary

### Backend (.env)
```
FLASK_ENV=production
SECRET_KEY=your-secure-key
SUPABASE_URL=your-url
SUPABASE_ANON_KEY=your-key
CORS_ORIGINS=your-netlify-domain.netlify.app
```

### Frontend (in index.html or netlify.toml)
```
window.__API_BASE__ = 'https://your-backend.render.com'
```

---

## Custom Domain Setup (Optional)

### For Backend (Render)
1. Go to Render dashboard → Your service
2. Settings → Custom Domain
3. Add your domain and follow DNS instructions

### For Frontend (Netlify)
1. Go to Netlify dashboard → Your site
2. Domain settings → Custom domains
3. Add your domain and update DNS records

---

## Support

For issues:
1. Check server logs (Render/Netlify dashboards)
2. Review browser console for frontend errors
3. Test API endpoints using Postman or curl
4. Verify all environment variables are set correctly

---

**Last Updated**: March 29, 2026
