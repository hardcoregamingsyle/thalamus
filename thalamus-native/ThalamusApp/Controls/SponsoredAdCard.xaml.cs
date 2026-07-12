using System;
using System.Diagnostics;
using System.Net.Http;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media.Imaging;

namespace ThalamusApp.Controls
{
    // Native mirror of the web SponsoredAdCard (src/pages/Portal.tsx). Renders one
    // Gravity contextual ad below a chat reply. Populate() takes the raw ad JsonNode
    // returned by gravityAds:requestAd — every field is optional, so each read is
    // defensive and a partial payload still shows something clickable.
    public partial class SponsoredAdCard : UserControl
    {
        private string? _impUrl;
        private string? _clickTarget;
        private bool _impressionFired;

        public SponsoredAdCard()
        {
            InitializeComponent();
            // Impression fires on first display, not on Populate — a card that never
            // gets shown must never count as an impression.
            Loaded += OnLoaded;
        }

        public void Populate(JsonNode ad)
        {
            _impUrl      = Str(ad, "impUrl");
            _clickTarget = Str(ad, "clickUrl") ?? Str(ad, "url");   // clickUrl wins; url is the fallback

            var title   = Str(ad, "title") ?? Str(ad, "brandName");
            var adText  = Str(ad, "adText");
            var cta     = Str(ad, "cta");
            var favicon = Str(ad, "favicon");

            TitleText.Text = title ?? "Sponsored";

            if (adText != null)
            {
                AdText.Text = adText;
                AdText.Visibility = Visibility.Visible;
            }
            if (cta != null)
            {
                CtaText.Text = cta + "  →";
                CtaText.Visibility = Visibility.Visible;
            }
            if (favicon != null)
                TryLoadFavicon(favicon);
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            if (_impressionFired || string.IsNullOrWhiteSpace(_impUrl)) return;
            _impressionFired = true;
            // Fire-and-forget impression pixel — one GET, never awaited. Offline or a
            // dead pixel must stay silent; an unfired impression never affects the user.
            try { _ = new HttpClient().GetAsync(_impUrl); }
            catch { /* swallow */ }
        }

        private void Card_Click(object sender, MouseButtonEventArgs e)
        {
            if (string.IsNullOrWhiteSpace(_clickTarget)) return;
            try { Process.Start(new ProcessStartInfo(_clickTarget) { UseShellExecute = true }); }
            catch { /* nothing sensible to do if the shell can't open the URL */ }
        }

        private void TryLoadFavicon(string url)
        {
            // Remote favicons can 404 or be a format WPF can't decode; failures raise
            // ImageFailed asynchronously rather than throwing, so just hide the slot.
            try
            {
                if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return;
                var bmp = new BitmapImage();
                bmp.BeginInit();
                bmp.CacheOption = BitmapCacheOption.OnLoad;
                bmp.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
                bmp.UriSource = uri;
                bmp.EndInit();
                FaviconImage.ImageFailed += (_, __) => FaviconImage.Visibility = Visibility.Collapsed;
                FaviconImage.Source = bmp;
                FaviconImage.Visibility = Visibility.Visible;
            }
            catch { /* bad/unsupported favicon URL — the card renders fine without it */ }
        }

        // Pull a non-empty string field off the ad object, tolerating a missing key,
        // a JSON null, or a non-string value (all collapse to null).
        private static string? Str(JsonNode node, string key)
        {
            try
            {
                var v = node[key];
                if (v is null) return null;
                var s = v.GetValue<string>();
                return string.IsNullOrWhiteSpace(s) ? null : s;
            }
            catch { return null; }
        }
    }
}
