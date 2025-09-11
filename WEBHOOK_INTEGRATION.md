# n8n Webhook Integration for MKFD

This feature adds the ability to automatically send POST webhooks to n8n (or any webhook endpoint) when new items are added to RSS feeds, plus manual triggering capability.

![Webhook Configuration Interface](https://github.com/user-attachments/assets/b78688cd-278c-4218-9aad-d8475efb6bc2)

## Features

### 🔄 Automatic Webhooks
- Automatically triggered when new items are detected in feeds
- Only sends new items (configurable)
- Supports all feed types (web scraping, API, email)
- Configurable format (XML or JSON)

### 🎯 Manual Webhooks  
- Manual trigger button on the feeds management page
- Useful for testing webhook configurations
- Sends all current feed items

### 📡 Webhook Configuration
- **Webhook URL**: Your n8n webhook endpoint
- **Format**: Choose between XML (raw RSS) or JSON (parsed data)
- **New Items Only**: Only trigger for genuinely new items
- **Custom Headers**: For authentication or custom headers

## Setup Instructions

### 1. Configure Feed with Webhook

1. Create or edit a feed in the MKFD web interface
2. Expand the "Additional Options" section
3. Check "Enable Webhook Notifications"
4. Configure the webhook settings:
   - **Webhook URL**: `https://your-n8n-instance.com/webhook/your-webhook-id`
   - **Format**: Choose XML for raw RSS or JSON for parsed data
   - **Headers**: Add authentication headers if needed

### 2. n8n Workflow Setup

#### Basic n8n Workflow:
1. **Webhook Trigger Node**
   - Method: POST
   - Response Mode: "Respond Immediately"

2. **Switch Node** (optional)
   - Route based on `triggerType` ("automatic" vs "manual")

3. **Processing Nodes**
   - Use the webhook data to process feed items
   - Access feed metadata and item details

#### Example JSON Webhook Payload:
```json
{
  "feedId": "unique-feed-id",
  "feedName": "My RSS Feed", 
  "feedType": "webScraping",
  "timestamp": "2023-12-07T10:30:00.000Z",
  "triggerType": "automatic",
  "itemCount": 3,
  "data": {
    "title": "Feed Title",
    "description": "Feed Description", 
    "items": [
      {
        "title": "Item Title",
        "description": "Item Description",
        "link": "https://example.com/item",
        "pubDate": "2023-12-07T10:00:00.000Z",
        "guid": "item-guid"
      }
    ]
  },
  "metadata": {
    "lastBuildDate": "2023-12-07T10:30:00.000Z",
    "feedUrl": "public/feeds/unique-feed-id.xml",
    "siteUrl": "https://source-website.com"
  }
}
```

#### Example XML Webhook Payload:
Raw RSS XML containing the feed items (full RSS structure).

### 3. Authentication

For secure webhooks, add authentication headers:

```json
{
  "Authorization": "Bearer your-api-token",
  "X-API-Key": "your-api-key"
}
```

## Usage Examples

### Example 1: News Aggregation
- Set up web scraping feeds for multiple news sites
- Configure webhooks to send to n8n
- n8n workflow processes and sends to Slack/Discord

### Example 2: Content Monitoring
- Monitor specific websites for new content
- Webhook triggers n8n workflow
- n8n enriches data and stores in database

### Example 3: Social Media Integration  
- API feeds from social platforms
- Webhooks trigger content analysis
- Auto-post to other platforms via n8n

## Manual Testing

1. Go to the "Active RSS Feeds" page (`/feeds`)
2. Find feeds with webhook enabled (marked with ✅)
3. Click "🪝 Trigger Webhook" button
4. Check n8n for received webhook data

## Troubleshooting

### Webhook Not Triggering
1. Check webhook URL is accessible
2. Verify headers/authentication
3. Check MKFD logs for error messages
4. Test with manual trigger first

### No New Items Detected
1. "New Items Only" may be preventing triggers
2. Disable temporarily to test
3. Check if RSS content is actually changing

### Authentication Issues
1. Verify authentication headers format
2. Check API keys/tokens are valid
3. Test webhook URL with external tools

## Technical Details

### Change Detection
- Compares RSS GUIDs and links between feed updates
- Stores feed history in `feed-history/` directory
- Only triggers webhooks for genuinely new items

### Error Handling
- Webhook failures don't stop feed updates
- Errors logged to console
- 10-second timeout for webhook requests

### Performance
- Webhooks sent asynchronously
- Feed updates continue even if webhook fails
- Minimal impact on feed generation performance

## API Endpoints

### Manual Webhook Trigger
```
POST /trigger-webhook
Content-Type: application/json

{
  "feedId": "your-feed-id"
}
```

Response:
```json
{
  "message": "Webhook triggered successfully",
  "feedId": "your-feed-id", 
  "webhookUrl": "webhook-endpoint",
  "itemCount": 5
}
```

## Configuration Examples

### Basic Configuration
```yaml
webhook:
  enabled: true
  url: "https://n8n.example.com/webhook/abc123"
  format: "json"
  newItemsOnly: true
```

### Advanced Configuration with Authentication
```yaml
webhook:
  enabled: true
  url: "https://n8n.example.com/webhook/abc123"
  format: "xml"
  newItemsOnly: true
  headers:
    Authorization: "Bearer your-token"
    X-API-Key: "your-key"
    Content-Type: "application/xml"
```