#!/bin/bash
set -e

echo "=========================================="
echo "PostgreSQL pgvector Extension Installer"
echo "=========================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Detect OS
OS=""
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    if [ -f /etc/debian_version ]; then
        OS="debian"
    elif [ -f /etc/redhat-release ]; then
        OS="redhat"
    fi
elif [[ "$OSTYPE" == "darwin"* ]]; then
    OS="macos"
fi

echo -e "${YELLOW}Detected OS: $OS${NC}"
echo ""

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo -e "${RED}ERROR: PostgreSQL (psql) is not installed or not in PATH${NC}"
    echo "Please install PostgreSQL first:"
    echo "  Ubuntu/Debian: sudo apt install postgresql postgresql-contrib"
    echo "  macOS: brew install postgresql"
    exit 1
fi

PG_VERSION=$(psql --version | grep -oP '\d+' | head -1)
echo -e "${GREEN}Found PostgreSQL version: $PG_VERSION${NC}"
echo ""

# Install pgvector based on OS
case $OS in
    debian)
        echo -e "${YELLOW}Installing pgvector on Ubuntu/Debian...${NC}"

        # Check if running as root or with sudo
        if [ "$EUID" -ne 0 ]; then
            echo -e "${YELLOW}This script needs sudo privileges to install system packages${NC}"
            SUDO="sudo"
        else
            SUDO=""
        fi

        # Install build dependencies
        echo "Installing build dependencies..."
        $SUDO apt update
        $SUDO apt install -y postgresql-server-dev-$PG_VERSION build-essential git

        # Clone and build pgvector
        echo "Cloning pgvector repository..."
        TEMP_DIR=$(mktemp -d)
        cd "$TEMP_DIR"
        git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
        cd pgvector

        echo "Building pgvector..."
        make

        echo "Installing pgvector..."
        $SUDO make install

        # Cleanup
        cd /
        rm -rf "$TEMP_DIR"

        echo -e "${GREEN}✓ pgvector installed successfully!${NC}"
        ;;

    macos)
        echo -e "${YELLOW}Installing pgvector on macOS...${NC}"

        if ! command -v brew &> /dev/null; then
            echo -e "${RED}ERROR: Homebrew is not installed${NC}"
            echo "Please install Homebrew first: https://brew.sh"
            exit 1
        fi

        brew install pgvector
        echo -e "${GREEN}✓ pgvector installed successfully!${NC}"
        ;;

    redhat)
        echo -e "${YELLOW}Installing pgvector on RedHat/CentOS...${NC}"

        if [ "$EUID" -ne 0 ]; then
            SUDO="sudo"
        else
            SUDO=""
        fi

        # Install build dependencies
        $SUDO yum install -y postgresql-devel gcc git make

        # Clone and build pgvector
        TEMP_DIR=$(mktemp -d)
        cd "$TEMP_DIR"
        git clone --branch v0.5.1 https://github.com/pgvector/pgvector.git
        cd pgvector
        make
        $SUDO make install

        # Cleanup
        cd /
        rm -rf "$TEMP_DIR"

        echo -e "${GREEN}✓ pgvector installed successfully!${NC}"
        ;;

    *)
        echo -e "${RED}ERROR: Unsupported operating system${NC}"
        echo "Please install pgvector manually following the instructions at:"
        echo "https://github.com/pgvector/pgvector#installation"
        exit 1
        ;;
esac

echo ""
echo "=========================================="
echo "Next Steps:"
echo "=========================================="
echo ""
echo "1. Restart PostgreSQL service:"
echo "   Ubuntu/Debian: sudo systemctl restart postgresql"
echo "   macOS: brew services restart postgresql"
echo ""
echo "2. Enable the extension in your database:"
echo "   psql -U postgres -d your_database -c \"CREATE EXTENSION IF NOT EXISTS vector;\""
echo ""
echo "3. Run Prisma migrations:"
echo "   cd /home/user/interactive-stories-live"
echo "   npx prisma migrate dev"
echo ""
echo -e "${GREEN}Installation complete!${NC}"
