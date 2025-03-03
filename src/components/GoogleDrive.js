import React, { useState, useEffect } from "react";
import { Table, Button, message, Modal, Input, Space } from "antd";
import { FolderOutlined, FileOutlined, ReloadOutlined } from "@ant-design/icons";

const CLIENT_ID = "5850929203-mveobbkvcmbmai06q9pmffrhjjslcbto.apps.googleusercontent.com";
const API_KEY = "AIzaSyC_T8LWftW5mbrSgwt-DOJeJPRekjPjjgA";
const DISCOVERY_DOC = "https://www.googleapis.com/discovery/v1/apis/drive/v3/rest";
const SCOPES = "https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/drive";
const OWNER_EMAIL = process.env.REACT_APP_OWNER_EMAIL;

function GoogleDrive() {
    const [isGapiLoaded, setIsGapiLoaded] = useState(false);
    const [isGisLoaded, setIsGisLoaded] = useState(false);
    const [tokenClient, setTokenClient] = useState(null);
    const [files, setFiles] = useState([]);
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [currentDriveUrl, setCurrentDriveUrl] = useState(null);

    useEffect(() => {
        console.log("GoogleDrive");

        // Load the Google API script
        const loadGapiScript = () => {
            const script = document.createElement("script");
            script.src = "https://apis.google.com/js/api.js";
            script.onload = gapiLoaded;
            document.body.appendChild(script);
        };

        // Load the Google Identity Services script
        const loadGisScript = () => {
            const script = document.createElement("script");
            script.src = "https://accounts.google.com/gsi/client";
            script.onload = gisLoaded;
            document.body.appendChild(script);
        };

        loadGapiScript();
        loadGisScript();
    }, []);

    const gapiLoaded = () => {
        window.gapi.load("client", initializeGapiClient);
    };

    const initializeGapiClient = async () => {
        await window.gapi.client.init({
            apiKey: API_KEY,
            discoveryDocs: [DISCOVERY_DOC],
        });
        setIsGapiLoaded(true);
    };

    const gisLoaded = () => {
        setTokenClient(
            window.google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: handleCallbackResponse,
            })
        );
        setIsGisLoaded(true);
    };

    const handleCallbackResponse = async (resp) => {
        if (resp.error !== undefined) {
            throw resp;
        }
        await listFiles(true);
    };

    const handleAuthClick = () => {
        if (window.gapi.client.getToken() === null) {
            tokenClient?.requestAccessToken({ prompt: "consent" });
        } else {
            tokenClient?.requestAccessToken({ prompt: "" });
        }
    };

    const handleSignoutClick = () => {
        const token = window.gapi.client.getToken();
        if (token !== null) {
            window.google.accounts.oauth2.revoke(token.access_token);
            window.gapi.client.setToken("");
            setFiles([]);
        }
    };

    // Function to get file permissions
    const getFilePermissions = async (fileId) => {
        try {
            const response = await window.gapi.client.drive.permissions.list({
                fileId: fileId,
                fields: "*",
            });
            console.log("response", response);
            return response.result.permissions;
        } catch (err) {
            console.error("Error getting file permissions:", err);
            return [];
        }
    };

    const getFileIdFromUrl = (url) => {
        // Extract file ID from Google Drive URL
        // Handles various Google Drive URL formats
        const patterns = [
            /\/file\/d\/([^/]+)/, // Format: https://drive.google.com/file/d/FILE_ID/...
            /id=([^&]+)/, // Format: https://drive.google.com/file?id=FILE_ID&...
            /folders\/([^?/]+)/, // Format: https://drive.google.com/folders/FILE_ID...
        ];

        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match) return match[1];
        }
        return null;
    };

    const listFiles = async (promptForUrl = true) => {
        try {
            let driveUrl;
            if (promptForUrl) {
                driveUrl = prompt("Enter Google Drive URL:");
                if (!driveUrl) return;
                setCurrentDriveUrl(driveUrl);
            } else {
                driveUrl = currentDriveUrl;
                if (!driveUrl) {
                    message.warning("No URL to refresh. Please enter a Google Drive URL first.");
                    return;
                }
            }

            setLoading(true);
            const fileId = getFileIdFromUrl(driveUrl);
            if (!fileId) {
                console.error("Invalid Google Drive URL");
                message.error("Invalid Google Drive URL");
                return;
            }

            // Get initial file/folder metadata
            const response = await window.gapi.client.drive.files.get({
                fileId: fileId,
                fields: "id, name, mimeType, size",
            });

            const rootItem = response.result;
            const allFiles = [];

            // Recursively fetch all files and folders
            async function fetchFilesRecursively(folderId) {
                const response = await window.gapi.client.drive.files.list({
                    q: `'${folderId}' in parents`,
                    fields: "files(id, name, mimeType, size)",
                    pageSize: 1000,
                });

                const items = response.result.files;
                for (const item of items) {
                    allFiles.push(item);
                    if (item.mimeType === "application/vnd.google-apps.folder") {
                        await fetchFilesRecursively(item.id);
                    }
                }
            }

            // Start with the root item
            allFiles.push(rootItem);
            if (rootItem.mimeType === "application/vnd.google-apps.folder") {
                await fetchFilesRecursively(fileId);
            }

            // Get permissions for all files
            const filesWithPermissions = await Promise.all(
                allFiles.map(async (file) => {
                    try {
                        const permResponse = await window.gapi.client.drive.permissions.list({
                            fileId: file.id,
                            fields: "permissions(emailAddress,role,displayName)",
                        });
                        const owner = permResponse.result.permissions.find((p) => p.role === "owner");
                        return {
                            ...file,
                            owners: owner
                                ? [
                                      {
                                          displayName: owner.displayName,
                                          emailAddress: owner.emailAddress,
                                      },
                                  ]
                                : [],
                        };
                    } catch (err) {
                        console.error(`Error getting permissions for file ${file.id}:`, err);
                        return file;
                    }
                })
            );
            setFiles(filesWithPermissions);
            setSelectedFiles([]);
        } catch (err) {
            console.error("Error getting files:", err);
            message.error("Failed to fetch files");
        } finally {
            setLoading(false);
        }
    };

    const handleTransferOwnership = async () => {
        const filesToTransfer = files.filter(
            (file) => selectedFiles.includes(file.id) && file.owners?.[0]?.emailAddress === OWNER_EMAIL
        );

        if (filesToTransfer.length === 0) {
            message.warning(`No selected files owned by ${OWNER_EMAIL}`);
            return;
        }

        Modal.confirm({
            title: "Transfer Ownership",
            content: <Input placeholder="Enter new owner's email address" id="newOwnerEmail" />,
            onOk: async () => {
                const newOwnerEmail = document.getElementById("newOwnerEmail").value;
                if (!newOwnerEmail) {
                    message.error("Please enter an email address");
                    return;
                }

                setLoading(true);
                try {
                    await Promise.all(
                        filesToTransfer.map((file) =>
                            window.gapi.client.drive.permissions.create({
                                fileId: file.id,
                                transferOwnership: true,
                                resource: {
                                    role: "owner",
                                    type: "user",
                                    emailAddress: newOwnerEmail,
                                },
                            })
                        )
                    );

                    message.success("Ownership transferred successfully!");
                    await listFiles(false);
                    setSelectedFiles([]);
                } catch (error) {
                    console.error("Error transferring ownership:", error);
                    message.error("Failed to transfer ownership. Please try again.");
                } finally {
                    setLoading(false);
                }
            },
        });
    };

    const handleSelectAll = (event) => {
        if (event.target.checked) {
            // Only select files owned by the specified email
            const selectableFiles = files
                .filter((file) => file.owners?.[0]?.emailAddress === OWNER_EMAIL)
                .map((file) => file.id);
            setSelectedFiles(selectableFiles);
        } else {
            setSelectedFiles([]);
        }
    };

    const handleSelectFile = (fileId, ownerEmail) => {
        // Only allow selection if the file is owned by the specified email
        if (ownerEmail !== OWNER_EMAIL) return;

        setSelectedFiles((prev) => {
            if (prev.includes(fileId)) {
                return prev.filter((id) => id !== fileId);
            } else {
                return [...prev, fileId];
            }
        });
    };

    const formatFileSize = (bytes) => {
        if (!bytes) return "N/A";
        const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
        if (bytes === 0) return "0 Byte";
        const i = parseInt(Math.floor(Math.log(bytes) / Math.log(1024)));
        return Math.round(bytes / Math.pow(1024, i), 2) + " " + sizes[i];
    };

    const columns = [
        {
            title: "Type",
            dataIndex: "mimeType",
            key: "type",
            width: 70,
            render: (mimeType) =>
                mimeType === "application/vnd.google-apps.folder" ? (
                    <FolderOutlined style={{ fontSize: "20px", color: "#ffd591" }} />
                ) : (
                    <FileOutlined style={{ fontSize: "20px", color: "#91caff" }} />
                ),
        },
        {
            title: "File Name",
            dataIndex: "name",
            key: "name",
        },
        {
            title: "File ID",
            dataIndex: "id",
            key: "id",
        },
        {
            title: "Size",
            dataIndex: "size",
            key: "size",
            render: (size) => formatFileSize(Number(size)),
        },
        {
            title: "Owner",
            dataIndex: "owners",
            key: "owner",
            render: (owners) => owners?.[0]?.displayName || "Unknown",
        },
    ];

    const rowSelection = {
        selectedRowKeys: selectedFiles,
        onChange: (selectedRowKeys) => {
            setSelectedFiles(selectedRowKeys);
        },
        getCheckboxProps: (record) => ({
            disabled: record.owners?.[0]?.emailAddress !== OWNER_EMAIL,
        }),
    };

    return (
        <div style={{ padding: "24px" }}>
            <h1>Google Drive API Transfer Ownership</h1>
            <Space style={{ marginBottom: 16 }}>
                {isGapiLoaded && isGisLoaded && (
                    <>
                        <Button type="primary" onClick={handleAuthClick}>
                            Authorize
                        </Button>
                        <Button onClick={handleSignoutClick}>Sign Out</Button>
                        <Button onClick={() => listFiles(true)}>Explore New URL</Button>
                        <Button icon={<ReloadOutlined />} onClick={() => listFiles(false)} loading={loading}>
                            Refresh
                        </Button>
                        {selectedFiles.length > 0 && (
                            <Button type="primary" onClick={handleTransferOwnership} loading={loading} danger>
                                Transfer Ownership ({selectedFiles.length} selected)
                            </Button>
                        )}
                    </>
                )}
            </Space>

            <Table
                rowSelection={rowSelection}
                columns={columns}
                dataSource={files}
                rowKey="id"
                loading={loading}
                pagination={{
                    current: currentPage,
                    pageSize: pageSize,
                    total: files.length,
                    showSizeChanger: true,
                    showTotal: (total) => `Total ${total} items`,
                    onChange: (page, size) => {
                        setCurrentPage(page);
                        setPageSize(size);
                    },
                    onShowSizeChange: (current, size) => {
                        setPageSize(size);
                        setCurrentPage(1);
                    },
                }}
            />
        </div>
    );
}

export default GoogleDrive;
