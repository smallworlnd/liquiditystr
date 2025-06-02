# liquiditystr

A single-page app that plugs into the customer-side [publsp](https://github.com/smallworlnd/publsp) API to provide streamlined access to LSPs that advertise liquidity through Nostr.

## Prerequisites

- Node.js 18+ and npm
- publsp backend running

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Start the publsp backend**: 
   Make sure your publsp API server is running on `http://localhost:8000`. See the main publsp repository for backend setup instructions.

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Open your browser**: 
   Navigate to `http://localhost:5173`

### Building the Container

```bash
# Build the Docker image
docker build -t liquiditystr:latest .

## Running the Container

### Standalone
```bash
docker run -d \
  --name liquiditystr \
  -p 8000:8000 \
  liquiditystr:latest
```

## Development

### API Integration

The frontend communicates with the publsp backend through these endpoints:
- `GET /api/ads/list` - Fetch available LSP advertisements
- `POST /api/orders/create` - Submit a new order
- `GET /api/channels/listen-status` - Stream channel status updates

## Workflow

1. **Browse LSPs**: View all available Lightning Service Provider advertisements with pricing and capacity information
2. **Select and Configure**: Choose an LSP and configure your desired channel parameters
3. **Submit Order**: Send the order request via Nostr and receive payment details
4. **Monitor Progress**: Real-time updates on channel funding and confirmation status
